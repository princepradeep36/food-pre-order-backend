-- 1. Vendors Table
CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    swish VARCHAR(50) NOT NULL
);

-- 2. Menu Items Table
CREATE TABLE menu_items (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    max_quantity INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

-- 3. Users Table (Authentication)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- In production, hash this!
    role VARCHAR(20) CHECK (role IN ('admin', 'vendor')),
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL
);

-- 4. Customers Table
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL
);

-- 5. Orders Table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
    total DECIMAL(10, 2) NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'UNPAID', -- Can be 'UNPAID' or 'PAID'
    delivery_status VARCHAR(20) DEFAULT 'Pending', -- Can be 'Pending' or 'Delivered'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Order Items Table
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);