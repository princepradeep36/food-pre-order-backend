const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(bodyParser.json());


// ✅ SERVE FRONTEND
app.use(express.static(path.join(__dirname, "public")));

/* ================= ADMIN ================= */

// Create Vendor
app.post("/admin/vendor", async (req, res) => {
  const { name, phone } = req.body;
  await pool.query(
    "INSERT INTO vendors(name, phone) VALUES($1,$2)",
    [name, phone]
  );
  res.send("Vendor created");
});

// Add Menu Item
// Add Menu Item
app.post("/admin/menu", async (req, res) => {
  try {
    const { vendor_id, item_name, price, max_quantity } = req.body;

    if (!vendor_id || !item_name || !price || !max_quantity) {
      return res.status(400).send("Missing required fields");
    }

    // Ensure numeric values
    const priceNum = Number(price);
    const maxQtyNum = Number(max_quantity);
    if (isNaN(priceNum) || priceNum <= 0 || isNaN(maxQtyNum) || maxQtyNum <= 0) {
      return res.status(400).send("Price and Max Quantity must be positive numbers");
    }

    await pool.query(
      "INSERT INTO menu_items(vendor_id, item_name, price, max_quantity) VALUES($1,$2,$3,$4)",
      [vendor_id, item_name, priceNum, maxQtyNum]
    );

    res.send("Menu item added");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


// Get Vendors
// Get all vendors with their menu items
app.get("/vendors", async (req, res) => {
  const vendors = await pool.query(`
    SELECT v.id, v.name, v.phone,
      json_agg(
        json_build_object(
          'id', m.id,
          'item_name', m.item_name,
          'price', m.price,
          'max_quantity', m.max_quantity
        )
      ) AS menu
    FROM vendors v
    LEFT JOIN menu_items m ON v.id = m.vendor_id
    GROUP BY v.id
    ORDER BY v.id
  `);
  res.json(vendors.rows);
});

app.put("/admin/menu/:id", async (req,res)=>{
  const { id } = req.params;
  const { item_name, price, max_quantity } = req.body;

  await pool.query(
    "UPDATE menu_items SET item_name=$1, price=$2, max_quantity=$3 WHERE id=$4",
    [item_name, price, max_quantity, id]
  );

  res.send("Menu item updated");
});


// DELETE menu item
app.delete("/admin/menu/:id", async (req,res)=>{
  const { id } = req.params;

  // check if menu item exists in any order
  const check = await pool.query(
    "SELECT COUNT(*) FROM order_items WHERE menu_item_id=$1",
    [id]
  );

  if(Number(check.rows[0].count) > 0){
    return res.status(400).send("Cannot delete menu item: already ordered by a customer");
  }

  await pool.query("DELETE FROM menu_items WHERE id=$1", [id]);
  res.send("Menu item deleted successfully");
});




app.delete("/admin/vendor/:id", async (req, res) => {
  await pool.query("DELETE FROM vendors WHERE id=$1", [req.params.id]);
  res.send("Vendor deleted");
});


/* ================= CUSTOMER ================= */

// Create Order
app.post("/order", async (req, res) => {
  const { name, phone, cart } = req.body;

  if (!name || !phone || !cart || Object.keys(cart).length === 0) {
    return res.status(400).json({ error: "Invalid order data" });
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
    cart[vendorId].items.forEach(i => {
      total += i.price * i.quantity;
    });

    const order = await pool.query(
      `INSERT INTO orders(customer_id,vendor_id,total,payment_status)
       VALUES($1,$2,$3,'UNPAID') RETURNING *`,
      [customer.rows[0].id, vendorId, total]
    );

    for (let i of cart[vendorId].items) {
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

// View Customer Orders
app.get("/orders/:phone", async (req, res) => {
  const data = await pool.query(`
    SELECT 
      o.id,
      o.total,
      o.payment_status,
      v.name AS vendor,
      v.phone AS vendor_phone
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    JOIN vendors v ON o.vendor_id = v.id
    WHERE c.phone = $1
    ORDER BY o.created_at DESC
  `, [req.params.phone]);

  res.json(data.rows);
});


app.get("/order/:orderId/details", async (req, res) => {
  const data = await pool.query(`
    SELECT oi.id, m.item_name, oi.quantity, m.price
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE oi.order_id = $1
  `, [req.params.orderId]);

  res.json(data.rows);
});

app.put("/order/item/:id", async (req, res) => {
  const { quantity } = req.body;

  if (quantity <= 0) {
    return res.status(400).send("Invalid quantity");
  }

  // UPDATE ITEM QUANTITY
  await pool.query(
    "UPDATE order_items SET quantity=$1 WHERE id=$2",
    [quantity, req.params.id]
  );

  // GET order_id for this item
  const orderRes = await pool.query(
    "SELECT order_id FROM order_items WHERE id=$1",
    [req.params.id]
  );
  const orderId = orderRes.rows[0].order_id;

  // MARK ORDER UNPAID
  await pool.query(
    "UPDATE orders SET payment_status='UNPAID' WHERE id=$1",
    [orderId]
  );

  res.send("Item updated and order marked UNPAID");
});


app.put("/order/:orderId/recalculate", async (req, res) => {
  const total = await pool.query(`
    SELECT SUM(oi.quantity * m.price) AS total
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE oi.order_id = $1
  `, [req.params.orderId]);

  await pool.query(
    "UPDATE orders SET total=$1 WHERE id=$2",
    [total.rows[0].total || 0, req.params.orderId]
  );

  res.send("Order total updated");
});

app.delete("/order/:id", async (req, res) => {
  await pool.query("DELETE FROM orders WHERE id=$1", [req.params.id]);
  res.send("Order deleted");
});

app.put("/order/:id/payment", async (req, res) => {
  const { status } = req.body; // PAID / UNPAID

  if (status === "PAID") {
    // update paid_quantity for all items
    await pool.query(
      "UPDATE order_items SET paid_quantity = quantity WHERE order_id=$1",
      [req.params.id]
    );
  }

  // update order status
  await pool.query(
    "UPDATE orders SET payment_status=$1 WHERE id=$2",
    [status, req.params.id]
  );

  // Calculate extra amount to pay (only newly added items)
  const extraRes = await pool.query(`
    SELECT SUM((quantity - paid_quantity) * m.price) AS extra
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE oi.order_id = $1
  `, [req.params.id]);

  res.json({ message: "Payment status updated", extra_amount: extraRes.rows[0].extra || 0 });
});



/* ================= VENDOR ================= */

app.get("/vendor/:id/orders", async (req, res) => {
  const data = await pool.query(`
    SELECT o.id,o.total,c.name,c.phone
    FROM orders o
    JOIN customers c ON o.customer_id=c.id
    WHERE o.vendor_id=$1
  `, [req.params.id]);

  res.json(data.rows);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "CustomerOrdering.html"));
});

const PORT = process.env.PORT || 3000; // use Render's port or fallback to 3000 locally
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));


// GET summary for all vendors
app.get("/vendor-summary", async (req, res) => {
  const data = await pool.query(`
    SELECT 
      v.id AS vendor_id,
      v.name AS vendor_name,
      v.phone AS vendor_phone,
      m.item_name,
      SUM(oi.quantity) AS total_quantity,
      SUM(oi.quantity * m.price) AS total_amount,
      o.payment_status
    FROM vendors v
    LEFT JOIN orders o ON v.id = o.vendor_id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN menu_items m ON oi.menu_item_id = m.id
    GROUP BY v.id, v.name, v.phone, m.item_name, o.payment_status
    ORDER BY v.id
  `);

  res.json(data.rows);
});
