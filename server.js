require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const pool = require("./db");

const app = express();

/* ================= CONFIG ================= */

// Allow frontend domain (replace with your frontend URL later)
app.use(cors({
  origin: "*", // later you can restrict to frontend URL
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.use(bodyParser.json());

/* ================= HEALTH CHECK ================= */
app.get("/health", (req, res) => {
  res.send("OK");
});

/* ================= ADMIN ================= */

// Create Vendor
app.post("/admin/vendor", async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).send("Missing fields");

  await pool.query(
    "INSERT INTO vendors(name, phone) VALUES($1,$2)",
    [name, phone]
  );

  res.send("Vendor created");
});

// Add Menu Item
app.post("/admin/menu", async (req, res) => {
  try {
    const { vendor_id, item_name, price, max_quantity } = req.body;

    if (!vendor_id || !item_name || price <= 0 || max_quantity <= 0) {
      return res.status(400).send("Invalid menu item data");
    }

    await pool.query(
      `INSERT INTO menu_items(vendor_id,item_name,price,max_quantity)
       VALUES($1,$2,$3,$4)`,
      [vendor_id, item_name, price, max_quantity]
    );

    res.send("Menu item added");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Get Vendors + Menu
app.get("/vendors", async (req, res) => {
  const vendors = await pool.query(`
    SELECT v.id, v.name, v.phone,
      COALESCE(
        json_agg(
          json_build_object(
            'id', m.id,
            'item_name', m.item_name,
            'price', m.price,
            'max_quantity', m.max_quantity
          )
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) AS menu
    FROM vendors v
    LEFT JOIN menu_items m ON v.id = m.vendor_id
    GROUP BY v.id
    ORDER BY v.id
  `);

  res.json(vendors.rows);
});

// Update Menu Item
app.put("/admin/menu/:id", async (req, res) => {
  const { item_name, price, max_quantity } = req.body;

  await pool.query(
    "UPDATE menu_items SET item_name=$1, price=$2, max_quantity=$3 WHERE id=$4",
    [item_name, price, max_quantity, req.params.id]
  );

  res.send("Menu updated");
});

// Delete Menu Item
app.delete("/admin/menu/:id", async (req, res) => {
  const check = await pool.query(
    "SELECT COUNT(*) FROM order_items WHERE menu_item_id=$1",
    [req.params.id]
  );

  if (+check.rows[0].count > 0) {
    return res.status(400).send("Item already ordered");
  }

  await pool.query("DELETE FROM menu_items WHERE id=$1", [req.params.id]);
  res.send("Menu item deleted");
});

// Delete Vendor
app.delete("/admin/vendor/:id", async (req, res) => {
  await pool.query("DELETE FROM vendors WHERE id=$1", [req.params.id]);
  res.send("Vendor deleted");
});

/* ================= CUSTOMER ================= */

// Create Order
app.post("/order", async (req, res) => {
  const { name, phone, cart } = req.body;

  if (!name || !phone || !cart || Object.keys(cart).length === 0) {
    return res.status(400).send("Invalid order");
  }

  let customer = await pool.query(
    "SELECT * FROM customers WHERE phone=$1",
    [phone]
  );

  if (customer.rows.length === 0) {
    customer = await pool.query(
      "INSERT INTO customers(name,phone) VALUES($1,$2) RETURNING *",
      [name, phone]
    );
  }

  const ordersCreated = [];

  for (const vendorId in cart) {
    let total = 0;
    cart[vendorId].items.forEach(i => total += i.price * i.quantity);

    const order = await pool.query(
      `INSERT INTO orders(customer_id,vendor_id,total,payment_status)
       VALUES($1,$2,$3,'UNPAID') RETURNING *`,
      [customer.rows[0].id, vendorId, total]
    );

    for (const i of cart[vendorId].items) {
      await pool.query(
        `INSERT INTO order_items(order_id,menu_item_id,quantity)
         VALUES($1,$2,$3)`,
        [order.rows[0].id, i.id, i.quantity]
      );
    }

    ordersCreated.push({
      vendor: cart[vendorId].vendor,
      vendor_phone: cart[vendorId].vendor_phone,
      total
    });
  }

  res.json(ordersCreated);
});

// View Orders
app.get("/orders/:phone", async (req, res) => {
  const data = await pool.query(`
    SELECT o.id,o.total,o.payment_status,
           v.name AS vendor,v.phone AS vendor_phone
    FROM orders o
    JOIN customers c ON o.customer_id=c.id
    JOIN vendors v ON o.vendor_id=v.id
    WHERE c.phone=$1
    ORDER BY o.created_at DESC
  `, [req.params.phone]);

  res.json(data.rows);
});

// Order Details
app.get("/order/:id/details", async (req, res) => {
  const data = await pool.query(`
    SELECT oi.id,m.item_name,oi.quantity,m.price
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id=m.id
    WHERE oi.order_id=$1
  `, [req.params.id]);

  res.json(data.rows);
});

// Vendor Summary
app.get("/vendor-summary", async (req, res) => {
  const data = await pool.query(`
    SELECT v.name AS vendor_name,v.phone,
           m.item_name,
           SUM(oi.quantity) total_quantity,
           SUM(oi.quantity*m.price) total_amount
    FROM vendors v
    LEFT JOIN orders o ON v.id=o.vendor_id
    LEFT JOIN order_items oi ON o.id=oi.order_id
    LEFT JOIN menu_items m ON oi.menu_item_id=m.id
    GROUP BY v.name,v.phone,m.item_name
    ORDER BY v.name
  `);

  res.json(data.rows);
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Backend API running on port ${PORT}`)
);
