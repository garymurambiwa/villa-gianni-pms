# COREPMS - Property Management System

A self-contained local property management system designed to run on a Local Area Network (LAN) with PostgreSQL database.

## Features

- **Front Desk Management**: Room reservations, check-in/check-out, guest management
- **Point of Sale (POS)**: Restaurant and bar order management
- **Inventory Management**: Stock tracking and supplier management
- **Housekeeping**: Room status and maintenance tracking
- **Night Audit**: Daily closing and reporting
- **User Management**: Role-based access control

## Requirements

- Node.js 18+ 
- PostgreSQL 14+ with pgAdmin
- Windows 10/11 (for Electron desktop app)

## Setup

### 1. Database Setup

1. Install PostgreSQL and pgAdmin on your server machine
2. Create a new database called `corepms_db`
3. Note your PostgreSQL connection details:
   - Host (use LAN IP address for network access, e.g., `192.168.1.100`)
   - Port (default: `5432`)
   - Username (default: `postgres`)
   - Password

### 2. Environment Configuration

Copy `.env.example` to `.env.development` (or `.env.production`) and update with your database credentials:

```env
DATABASE_URL=postgres://postgres:your_password@192.168.1.100:5432/corepms_db
PGHOST=192.168.1.100
PGPORT=5432
PGDATABASE=corepms_db
PGUSER=postgres
PGPASSWORD=your_password
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Application

**Development mode (browser):**
```bash
npm run dev
```

**Electron desktop app:**
```bash
npm run electron:dev
```

## Database

The application automatically creates all required database tables on first connection. No manual table creation is needed.

### Automatic Schema Creation

When the application connects to PostgreSQL for the first time, it will:
- Create all necessary tables (users, rooms, reservations, orders, etc.)
- Set up indexes for optimal performance
- Create the default admin user (username: `admin`, password: `test123`)

### Data Persistence

All data is stored in PostgreSQL and persists across application restarts. The database connection is configured through environment variables or the application's database settings dialog.

## LAN Configuration

For network access within your local area network:

1. Configure PostgreSQL to accept connections from your LAN (edit `pg_hba.conf`)
2. Use the server's LAN IP address in your connection string
3. Ensure firewall allows PostgreSQL port (default: 5432)

## Default Login

- **Username**: `admin`
- **Password**: `test123`

*Please change the default password after first login.*

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run electron:dev` - Run Electron app in development
- `npm run electron:build` - Build Electron installer
- `npm run test` - Run tests
- `npm run db:check` - Test database connection

## License

Copyright © 2025 COREPMS. All rights reserved.
