# Partner Deployment Setup Guide

## 📋 Step 1: Download Your SSH Private Key

**FILE PATH:** 
```
C:\Users\Infinity\.ssh\partner_hetzner_key
```

Ask your partner to copy this file to their local machine (keep it safe and secure):
- **Windows:** Save to `C:\Users\[YourUsername]\.ssh\partner_hetzner_key`
- **Mac/Linux:** Save to `~/.ssh/partner_hetzner_key` and run `chmod 600 ~/.ssh/partner_hetzner_key`

---

## 🖥️ Step 2: Server Details (Share with Partner)

```
Server IP:     178.104.176.191
Username:      root
SSH Port:      22
```

---

## 📦 Step 3: Project Locations on Server

```
Villa Gianni:  /var/www/villa-gianni
Baradzanwa:    /var/www/baradzanwa
```

---

## 🚀 Step 4: Deployment Commands

Your partner can copy and use these commands directly:

### **For Villa Gianni:**
```powershell
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "cd /var/www/villa-gianni && git pull origin main && npm run build"
```

### **For Baradzanwa:**
```powershell
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "cd /var/www/baradzanwa && git pull origin main && npm run build"
```

### **Deploy Both Projects:**
```powershell
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "cd /var/www/villa-gianni && git pull origin main && npm run build && echo '✓ Villa Gianni deployed' && cd /var/www/baradzanwa && git pull origin main && npm run build && echo '✓ Baradzanwa deployed'"
```

---

## 📌 Step 5: Testing Connection

Before deploying, test SSH access:
```powershell
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "echo 'Connection successful!'"
```

---

## 🔐 Security Notes

✅ **This key is unique and not tied to your personal account**  
✅ **Keep the private key file safe** — treat it like a password  
❌ **Never share the private key publicly**  
✅ **The key can be revoked anytime** from the server  

---

## 📚 What These Commands Do

1. **`git pull origin main`** — Pulls latest code from GitHub
2. **`npm run build`** — Rebuilds the app with the latest code and environment variables
3. Commands are non-blocking — partner can run multiple deployments

---

## ⚡ Quick Copy-Paste Setup

Replace `[YourUsername]` with actual Windows username:

**For Windows PowerShell** (recommended):
```powershell
# Test connection
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "echo 'Ready to deploy!'"

# Deploy Villa Gianni
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "cd /var/www/villa-gianni && git pull origin main && npm run build"

# Deploy Baradzanwa
ssh -i "C:\Users\[YourUsername]\.ssh\partner_hetzner_key" -o StrictHostKeyChecking=no root@178.104.176.191 "cd /var/www/baradzanwa && git pull origin main && npm run build"
```

---

## 🆘 Troubleshooting

**"Permission denied (publickey)"**  
→ Make sure the private key path is correct and file exists

**"git: command not found"**  
→ Server needs git installed (contact admin)

**"npm: command not found"**  
→ Server needs Node.js installed (contact admin)

**Build takes too long**  
→ This is normal — can take 15-30 seconds depending on changes

---

## 📞 Support

If partner needs help:
- Verify server IP: `178.104.176.191`
- Check key permissions: `ls -la ~/.ssh/partner_hetzner_key` (Mac/Linux)
- Test SSH: `ssh -i [key-path] root@178.104.176.191 "echo test"`

---

**Generated:** 2026-06-24  
**For:** Partner Deployment Access
