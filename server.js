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
  const { name, phone, swish } = req.body;
  if (!name || !phone || !swish) return res.status(400).send("Missing fields");

  await pool.query(
    "INSERT INTO vendors(name, phone, swish) VALUES($1,$2,$3)",
    [name, phone, swish]
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

app.put("/order/:id/payment", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE orders
       SET payment_status = 'PAID'
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({ success: true, extra_amount: 0 });

  } catch (err) {
    console.error("MARK PAID ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/order/:id", async (req, res) => {
  try {
    await pool.query("BEGIN");

    await pool.query(
      "DELETE FROM order_items WHERE order_id = $1",
      [req.params.id]
    );

    const result = await pool.query(
      "DELETE FROM orders WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (result.rowCount === 0) {
      throw new Error("Order not found");
    }

    await pool.query("COMMIT");
    res.json({ success: true });

  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("DELETE ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/order/item/:id", async (req, res) => {
  const { quantity } = req.body;

  try {
    await pool.query(
      "UPDATE order_items SET quantity = $1 WHERE id = $2",
      [quantity, req.params.id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("UPDATE ITEM ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/order/:id/recalculate", async (req, res) => {
  try {
    await pool.query(`
      UPDATE orders o
      SET total = (
        SELECT COALESCE(SUM(oi.quantity * m.price), 0)
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        WHERE oi.order_id = o.id
      )
      WHERE o.id = $1
    `, [req.params.id]);

    res.json({ success: true });

  } catch (err) {
    console.error("RECALCULATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get all vendors (simpler version for frontend dropdown)
app.get("/vendors-dropdown", async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, phone FROM vendors ORDER BY name`);
    res.json(result.rows); // returns [{id, name, phone}, ...]
  } catch (err) {
    console.error("ERROR /vendors-dropdown:", err);
    res.status(500).json({ error: "Unable to fetch vendors" });
  }
});

// Get all orders for a specific vendor
app.get("/vendor-orders/:vendorId", async (req, res) => {
  const { vendorId } = req.params;

  try {
    const data = await pool.query(`
      SELECT 
        c.id AS customer_id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        m.item_name,
        oi.quantity
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.vendor_id = $1
      ORDER BY c.name
    `, [vendorId]);

    res.json(data.rows); // array of {customer_id, customer_name, customer_phone, item_name, quantity}
  } catch (err) {
    console.error("ERROR /vendor-orders/:vendorId:", err);
    res.status(500).json({ error: "Unable to fetch vendor orders" });
  }
});



/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Backend API running on port ${PORT}`)
);
