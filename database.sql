CREATE DATABASE food_app;
\c food_app;
CREATE TABLE public.customers (
	id serial4 NOT NULL,
	"name" text NOT NULL,
	phone varchar(15) NOT NULL,
	CONSTRAINT customers_phone_key UNIQUE (phone),
	CONSTRAINT customers_pkey PRIMARY KEY (id)
);


CREATE TABLE public.menu_items (
	id serial4 NOT NULL,
	vendor_id int4 NULL,
	item_name text NOT NULL,
	price numeric(10, 2) NOT NULL,
	max_quantity int4 DEFAULT 50 NULL,
	CONSTRAINT menu_items_pkey PRIMARY KEY (id)
);


ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;

CREATE TABLE public.order_items (
	id serial4 NOT NULL,
	order_id int4 NULL,
	menu_item_id int4 NULL,
	quantity int4 NOT NULL,
	paid_quantity int4 DEFAULT 0 NULL,
	CONSTRAINT order_items_pkey PRIMARY KEY (id)
);


ALTER TABLE public.order_items ADD CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


CREATE TABLE public.orders (
	id serial4 NOT NULL,
	customer_id int4 NULL,
	vendor_id int4 NULL,
	total numeric(10, 2) NULL,
	created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
	payment_status varchar(10) DEFAULT 'UNPAID'::character varying NULL,
	CONSTRAINT orders_pkey PRIMARY KEY (id)
);


ALTER TABLE public.orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


CREATE TABLE public.vendors (
	id serial4 NOT NULL,
	"name" text NOT NULL,
	phone varchar(15) NOT NULL,
	CONSTRAINT vendors_pkey PRIMARY KEY (id)
);
