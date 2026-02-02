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

/* ================= AUTHENTICATION ROUTES ================= */

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    if (user.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    // In a real app, use bcrypt.compare here
    if (user.rows[0].password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { role, vendor_id } = user.rows[0];
    res.json({ role, vendor_id });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/admin/users", async (req, res) => {
  const { username, password, role, vendor_id } = req.body;
  try {
    await pool.query(
      "INSERT INTO users(username, password, role, vendor_id) VALUES($1, $2, $3, $4)",
      [username, password, role, vendor_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

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
        ) FILTER (WHERE m.id IS NOT NULL AND m.is_active = TRUE), 
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
  // Soft delete to preserve order history constraints
  await pool.query("UPDATE menu_items SET is_active = FALSE WHERE id=$1", [req.params.id]);
  res.send("Deleted (Soft)");
});

app.post("/vendor/menu", async (req, res) => {
  const { vendor_id, item_name, price, max_quantity } = req.body;
  try {
    await pool.query("INSERT INTO menu_items(vendor_id,item_name,price,max_quantity) VALUES($1,$2,$3,$4)",
      [vendor_id, item_name, price, max_quantity]);
    res.json({ success: true });
  } catch (err) { res.status(500).send(err.message); }
});

/* ================= CUSTOMER & ORDER ROUTES ================= */

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
    SELECT oi.id, m.item_name, oi.quantity, m.price FROM order_items oi 
    JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id=$1`, [req.params.id]);
  res.json(data.rows);
});

app.put("/order/:id/pay", async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE orders SET payment_status = 'PAID' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).send("Order not found");
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).send(err.message);
  }
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
    WHERE o.vendor_id = $1 AND o.payment_status = 'PAID' ORDER BY o.id DESC`, [req.params.vendorId]);
  res.json(data.rows);
});

app.get("/vendor-summary", async (req, res) => {
  const data = await pool.query(`
    SELECT v.name AS vendor_name, v.phone, m.item_name, SUM(oi.quantity) AS total_quantity, SUM(oi.quantity * m.price) AS total_amount
    FROM orders o JOIN vendors v ON o.vendor_id = v.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE o.payment_status = 'PAID'
    GROUP BY v.id, v.name, v.phone, m.item_name`);
  res.json(data.rows);
});

app.put("/order/:id/delivery", async (req, res) => {
  const { status } = req.body;
  await pool.query("UPDATE orders SET delivery_status = $1 WHERE id = $2", [status, req.params.id]);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;

/* ================= ADMIN ORDER MANAGEMENT ================= */

// Helper to recalculate order total
async function recalcOrderTotal(orderId) {
  const res = await pool.query(`
    SELECT SUM(oi.quantity * m.price) as new_total
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE oi.order_id = $1
  `, [orderId]);

  const newTotal = res.rows[0].new_total || 0;
  await pool.query("UPDATE orders SET total = $1 WHERE id = $2", [newTotal, orderId]);
}

app.get("/admin/orders", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.total, o.payment_status, o.delivery_status, o.created_at,
             v.name AS vendor_name, c.name AS customer_name, c.phone AS customer_phone
      FROM orders o
      JOIN vendors v ON o.vendor_id = v.id
      JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).send(err.message); }
});

app.delete("/admin/order/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM orders WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).send(err.message); }
});

app.delete("/admin/order-item/:id", async (req, res) => {
  try {
    const del = await pool.query("DELETE FROM order_items WHERE id=$1 RETURNING order_id", [req.params.id]);
    if (del.rows.length > 0) {
      await recalcOrderTotal(del.rows[0].order_id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Item not found" });
    }
  } catch (err) { res.status(500).send(err.message); }
});

app.put("/admin/order-item/:id", async (req, res) => {
  const { quantity } = req.body;
  if (quantity < 1) return res.status(400).send("Qty must be positive");
  try {
    const update = await pool.query("UPDATE order_items SET quantity=$1 WHERE id=$2 RETURNING order_id", [quantity, req.params.id]);
    if (update.rows.length > 0) {
      await recalcOrderTotal(update.rows[0].order_id);
      res.json({ success: true });
    } else {
      res.status(404).send("Item not found");
    }
  } catch (err) { res.status(500).send(err.message); }
});

// Reuse existing details endpoint for fetching items of an order
// app.get("/order/:id/details") is already available and public

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));