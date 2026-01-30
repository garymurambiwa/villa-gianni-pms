# COREPMS Installation Guide

## System Requirements

- **Windows**: Windows 10/11 or Server 2016+ (x64)
- **Linux**: Ubuntu 20.04+, RHEL 8+, or compatible (x64)
- **macOS**: macOS 11.0 (Big Sur) or later (x64/ARM64)
- **RAM**: Minimum 4GB (8GB recommended)
- **Disk Space**: 1GB free space

## Windows Installation

1.  **Download** the installer (`COREPMS-Setup-0.3.0.exe` or `.msi`).
2.  **Run** the installer. It requires Administrator privileges to install prerequisites (VC++ Redistributable) and set up system environment variables.
3.  **Silent Install** (for admins):
    ```powershell
    COREPMS-Setup-0.3.0.exe /S
    ```
    The installer will automatically:
    - Install VC++ Redistributable if missing.
    - Copy application files and bundled PostgreSQL database.
    - Create Start Menu and Desktop shortcuts.

4.  **First Launch & Wizard**:
    - Launch the application from Desktop or Start Menu.
    - The application will automatically initialize the local PostgreSQL database.
    - A **First-Run Wizard** will appear. Choose:
      - **Main Server**: If this computer will store the data.
      - **Workstation Client**: To connect to another computer running COREPMS.
    - The wizard will verify database connectivity before proceeding.

## Linux Installation

1.  **Debian/Ubuntu**:
    ```bash
    sudo dpkg -i corepms_0.3.0_amd64.deb
    ```
2.  **RHEL/CentOS/Fedora**:
    ```bash
    sudo rpm -i corepms-0.3.0.x86_64.rpm
    ```
3.  **AppImage**:
    ```bash
    chmod +x COREPMS-0.3.0.AppImage
    ./COREPMS-0.3.0.AppImage
    ```

## macOS Installation

1.  **Download** the `.dmg` or `.pkg` file.
2.  **Install**:
    - For `.dmg`: Drag the COREPMS icon to the Applications folder.
    - For `.pkg`: Run the installer wizard.

## Database Connectivity

The application uses a bundled PostgreSQL 14 database. You can connect to this database using standard PostgreSQL clients (like pgAdmin, DBeaver, or psql) for reporting, maintenance, or integration purposes.

### Connection Parameters

| Parameter | Value |
|-----------|-------|
| **Hostname** | `127.0.0.1` (localhost) or Server IP |
| **Port** | `54320` (Note: Non-standard port) |
| **Database** | `corepms_db` |
| **Username** | `postgres` |
| **Password** | `corepms_local` |
| **SSL/TLS** | Disabled (Trusted internal network) |

### Connection String

Use the following connection string format:

```text
postgresql://postgres:corepms_local@127.0.0.1:54320/corepms_db
```

### Remote Connections (New in v0.2.9)

By default, the database is now **Network Ready**. It listens on all interfaces (`0.0.0.0`) and allows connections from any subnet.

**Security Warning**: Ensure your network is secure. The database accepts connections on port 54320.

**Firewall**: The installer automatically adds a Windows Firewall rule to allow inbound TCP traffic on port 54320 for the "Main Server" installation.

### Troubleshooting Connectivity

-   **Connection Refused**:
    - Ensure the application is **running**. The database only runs when the COREPMS app is open.
    - Verify you are using port **54320**, not the default 5432.
    - Check if a firewall is blocking the port (ensure rule "PostgreSQL (COREPMS)" exists).

-   **Authentication Failed**:
    - Verify the password is exactly `corepms_local`.
    - If you changed the password, use the new one.

## Verification

After installation, the application includes a built-in health check script located in the `resources` folder.

1.  Open a terminal/command prompt.
2.  Navigate to the application installation directory (e.g., `C:\Program Files\COREPMS\resources`).
3.  Run the verification script (requires Node.js if running raw, or use the app's internal diagnostics):
    ```bash
    node verify-install.js
    ```
4.  Output should show `INSTALLATION_SUCCESS`.
