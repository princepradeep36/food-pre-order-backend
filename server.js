require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const pool = require("./db");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.use(bodyParser.json());

/* ================= ADMIN ROUTES (Crucial - Do not remove) ================= */

app.post("/admin/vendor", async (req, res) => {
  const { name, phone, swish } = req.body;
  try {
    await pool.query("INSERT INTO vendors(name, phone, swish) VALUES($1,$2,$3)", [name, phone, swish]);
    res.send("Vendor created");
  } catch (err) { res.status(500).send(err.message); }
});

app.post("/admin/menu", async (req, res) => {
  const { vendor_id, item_name, price, max_quantity } = req.body;
  try {
    await pool.query("INSERT INTO menu_items(vendor_id,item_name,price,max_quantity) VALUES($1,$2,$3,$4)",
      [vendor_id, item_name, price, max_quantity]);
    res.send("Menu item added");
  } catch (err) { res.status(500).send(err.message); }
});

app.get("/vendors", async (req, res) => {
  const vendors = await pool.query(`
    SELECT 
      v.id, 
      v.name, 
      v.phone, 
      v.swish,
      COALESCE(
        json_agg(
          json_build_object(
            'id', m.id, 
            'item_name', m.item_name, 
            'price', m.price, 
            'max_quantity', m.max_quantity,
            'sold_quantity', COALESCE(sold.qty, 0)
          ) ORDER BY m.id
        ) FILTER (WHERE m.id IS NOT NULL), 
        '[]'
      ) AS menu
    FROM vendors v 
    LEFT JOIN menu_items m ON v.id = m.vendor_id
    LEFT JOIN (
      SELECT menu_item_id, SUM(quantity) as qty
      FROM order_items
      GROUP BY menu_item_id
    ) sold ON m.id = sold.menu_item_id
    GROUP BY v.id 
    ORDER BY v.id
  `);
  res.json(vendors.rows);
});

app.delete("/admin/menu/:id", async (req, res) => {
  await pool.query("DELETE FROM menu_items WHERE id=$1", [req.params.id]);
  res.send("Deleted");
});

/* ================= CUSTOMER & ORDER ROUTES ================= */

app.post("/order", async (req, res) => {
  const { name, phone, cart } = req.body;
  let customer = await pool.query("SELECT id FROM customers WHERE phone=$1", [phone]);
  if (customer.rows.length === 0) {
    customer = await pool.query("INSERT INTO customers(name,phone) VALUES($1,$2) RETURNING id", [name, phone]);
  }
  const customerId = customer.rows[0].id;

  for (const vendorId in cart) {
    let total = 0;
    cart[vendorId].items.forEach(i => total += i.price * i.quantity);
    const pStatus = cart[vendorId].paid ? 'PAID' : 'UNPAID';

    const order = await pool.query(
      "INSERT INTO orders(customer_id, vendor_id, total, payment_status, delivery_status) VALUES($1,$2,$3,$4,'Pending') RETURNING id",
      [customerId, vendorId, total, pStatus]
    );

    for (const item of cart[vendorId].items) {
      await pool.query("INSERT INTO order_items(order_id, menu_item_id, quantity) VALUES($1,$2,$3)",
        [order.rows[0].id, item.id, item.quantity]);
    }
  }
  res.json({ success: true });
});

app.get("/orders/:phone", async (req, res) => {
  const data = await pool.query(`
    SELECT o.id, o.total, o.payment_status, o.delivery_status, v.name AS vendor 
    FROM orders o JOIN vendors v ON o.vendor_id = v.id
    JOIN customers c ON o.customer_id = c.id WHERE c.phone=$1`, [req.params.phone]);
  res.json(data.rows);
});

app.get("/order/:id/details", async (req, res) => {
  const data = await pool.query(`
    SELECT m.item_name, oi.quantity, m.price FROM order_items oi 
    JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id=$1`, [req.params.id]);
  res.json(data.rows);
});

/* ================= VENDOR DASHBOARD ROUTES ================= */

app.get("/vendors-dropdown", async (req, res) => {
  const result = await pool.query("SELECT id, name FROM vendors ORDER BY name");
  res.json(result.rows);
});

app.get("/vendor-orders/:vendorId", async (req, res) => {
  const data = await pool.query(`
    SELECT o.id AS order_id, o.delivery_status, c.name AS customer_name, c.phone AS customer_phone, m.item_name, oi.quantity
    FROM orders o JOIN customers c ON o.customer_id = c.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE o.vendor_id = $1 ORDER BY o.id DESC`, [req.params.vendorId]);
  res.json(data.rows);
});

app.get("/vendor-summary", async (req, res) => {
  const data = await pool.query(`
    SELECT v.name AS vendor_name, v.phone, m.item_name, SUM(oi.quantity) AS total_quantity, SUM(oi.quantity * m.price) AS total_amount
    FROM orders o JOIN vendors v ON o.vendor_id = v.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON oi.menu_item_id = m.id
    GROUP BY v.id, v.name, v.phone, m.item_name`);
  res.json(data.rows);
});

app.put("/order/:id/delivery", async (req, res) => {
  const { status } = req.body;
  await pool.query("UPDATE orders SET delivery_status = $1 WHERE id = $2", [status, req.params.id]);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));