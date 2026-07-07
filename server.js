const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');

// Variable to store the active store announcement
let currentStoreNotice = "Welcome to DE Chis Stores Portal!";

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔒 ADMIN AUTHENTICATION SHIELD (BASIC AUTH)
// ==========================================
function adminGuard(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="DE Chis Stores Admin Dashboard"');
        return res.status(401).send('Admin access denied. Please log in.');
    }

    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const username = auth[0];
    const password = auth[1];

    // 🌟 CHANGE YOUR CREDENTIALS HERE FOR THE GOVERNOR'S VISIT:
    if (username === 'admin' && password === 'chis1234') {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="DE Chis Stores Admin Dashboard"');
        return res.status(401).send('Invalid Admin Credentials.');
    }
}

// Intercept the admin webpage before static files can serve it openly
app.get('/admin.html', adminGuard);

app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// CONNECT TO MONGO_DB CLOUD VAULT
// ==========================================
// 📱 CRITICAL: Stop mongoose from buffering/freezing requests when the database is offline
mongoose.set('bufferCommands', false);

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/de_chis_store";

let isDatabaseConnected = false;

mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 }) // Gives up waiting after 5 seconds instead of hanging
    .then(() => {
        console.log("Connected securely to MongoDB Database Vault!");
        isDatabaseConnected = true;
        seedInitialEmployees();
    })
    .catch(err => {
        console.error("❌ DATABASE CONFIGURATION ERROR:", err.message);
        isDatabaseConnected = false;
    });

// ==========================================
// DEFINING PERMANENT SCHEMAS
// ==========================================
const employeeSchema = new mongoose.Schema({ 
    id: String, 
    name: String,
    requiredHours: { type: Number, default: 10 }
});
const Employee = mongoose.model('Employee', employeeSchema);

const logSchema = new mongoose.Schema({
    id: String,
    name: String,
    date: String,
    checkIn: String,
    checkInRaw: Number,
    checkOut: String,
    hoursWorked: String,
    flagged: Boolean,
    deviceToken: String
});
const AttendanceLog = mongoose.model('AttendanceLog', logSchema);

const reportSchema = new mongoose.Schema({
    id: String,
    name: String,
    date: String,
    reason: String,
    submittedAt: String
});
const AbsenceReport = mongoose.model('AbsenceReport', reportSchema);

async function seedInitialEmployees() {
    try {
        const count = await Employee.countDocuments();
        if (count === 0) {
            await Employee.insertMany([
                { id: "EMP001", name: "John Doe", requiredHours: 10 },
                { id: "EMP002", name: "Blessing Okafor", requiredHours: 10 },
                { id: "EMP003", name: "Amara Musa", requiredHours: 10 }
            ]);
            console.log("Initial default staff records successfully seeded.");
        }
    } catch(e) {
        console.error("Failed to seed data structure:", e.message);
    }
}

const CUTOFF_TIME = "21:00";   
const MAX_DISTANCE_KM = 0.5;   
const STORE_LAT = 9.852912;     
const STORE_LON = 8.853000;     

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

const getTodayDate = () => new Date().toISOString().split('T')[0];

// Middleware helper to reject transactions instantly if the database link is broken
app.use((req, res, next) => {
    if (!isDatabaseConnected && req.path.startsWith('/api/')) {
        return res.status(503).json({ 
            success: false, 
            message: "Database offline. Check your network or connection string!" 
        });
    }
    next();
});

// ==========================================
// 📡 API ENDPOINTS
// ==========================================

// 1. Fetch Employee Live Status
app.get('/api/attendance/status/:empId', async (req, res) => {
    try {
        const { empId } = req.params;
        const today = getTodayDate();
        
        const employee = await Employee.findOne({ id: empId });
        if (!employee) return res.json({ status: "unregistered" });

        const log = await AttendanceLog.findOne({ id: empId, date: today });
        if (!log) return res.json({ status: "not_checked_in", name: employee.name });
        if (log && !log.checkOut) return res.json({ status: "checked_in", name: employee.name, checkInTime: log.checkIn });
        return res.json({ status: "completed", name: employee.name });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database read failure." });
    }
});

// 2. Process Employee Clocking Actions
app.post('/api/attendance', async (req, res) => {
    try {
        const { employeeId, action, lat, lon } = req.body;
        const today = getTodayDate();
        const now = new Date();
        const currentTimeString = now.toTimeString().split(' ')[0].substring(0, 5);

        const employee = await Employee.findOne({ id: employeeId });
        if (!employee) return res.status(400).json({ success: false, message: "ID not registered." });

        if (!lat || !lon) return res.status(400).json({ success: false, message: "Location tracking must be enabled." });

        const distance = getDistance(STORE_LAT, STORE_LON, lat, lon);
        if (distance > MAX_DISTANCE_KM) return res.status(400).json({ success: false, message: "You must be at the supermarket premises." });

        let deviceToken = req.cookies.de_chis_device_token;
        let log = await AttendanceLog.findOne({ id: employeeId, date: today });

        if (action === 'checkin') {
            if (log) return res.status(400).json({ success: false, message: "Already checked in today." });
            if (currentTimeString > CUTOFF_TIME) return res.status(400).json({ success: false, message: `Late! Cutoff was ${CUTOFF_TIME}.` });

            if (deviceToken) {
                const deviceAlreadyUsedToday = await AttendanceLog.findOne({ date: today, deviceToken: deviceToken });
                if (deviceAlreadyUsedToday) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "Security Alert: Device matching active attendance log." 
                    });
                }
            } else {
                deviceToken = 'chis_device_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
                res.cookie('de_chis_device_token', deviceToken, { maxAge: 2*365*24*60*60*1000, httpOnly: true, sameSite: 'lax'});
            }

            await AttendanceLog.create({
                id: employeeId,
                name: employee.name,
                date: today,
                checkIn: now.toLocaleTimeString(),
                checkInRaw: now.getTime(), 
                checkOut: null,
                hoursWorked: null,
                flagged: false,
                deviceToken: deviceToken
            });

            return res.json({ success: true, message: `Welcome, ${employee.name}!` });

        } else if (action === 'checkout') {
            if (!log) return res.status(400).json({ success: false, message: "Must check in first." });
            if (log.checkOut) return res.status(400).json({ success: false, message: "Already checked out." });

            const checkOutRaw = now.getTime();
            const millisecondsWorked = checkOutRaw - log.checkInRaw;
            const hoursWorked = (millisecondsWorked / (1000 * 60 * 60)).toFixed(2); 

            log.checkOut = now.toLocaleTimeString();
            log.hoursWorked = `${hoursWorked} hrs`;
            
            const employeeTargetHours = employee.requiredHours || 10;
            
            if (parseFloat(hoursWorked) < employeeTargetHours) {
                log.flagged = true;
                await log.save();
                return res.json({ success: true, message: `Goodbye! Early Departure Flagged.` });
            }

            await log.save();
            return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed.` });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Database transaction failure." });
    }
});

// 3. File Absence Report
app.post('/api/absence-report', async (req, res) => {
    try {
        const { employeeId, reason } = req.body;
        const today = getTodayDate();
        
        const actualEmployee = await Employee.findOne({ id: employeeId });
        if (!actualEmployee) return res.status(400).json({ success: false, message: "Invalid Employee ID." });
        if (!reason.trim()) return res.status(400).json({ success: false, message: "Please state a valid reason." });

        await AbsenceReport.create({
            id: employeeId,
            name: actualEmployee.name,
            date: today,
            reason: reason,
            submittedAt: new Date().toLocaleTimeString()
        });

        res.json({ success: true, message: "Absence report forwarded to Admin successfully." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server database connection fault." });
    }
});

// 4. Fetch Master Matrix Logs (PROTECTED - UPDATED FOR DIGITAL NOTICE BOARD)
app.get('/api/admin/data', adminGuard, async (req, res) => {
    try {
        const logs = await AttendanceLog.find({});
        const employeeList = await Employee.find({});
        const absenceReports = await AbsenceReport.find({});
        
        // Added currentNotice payload so the admin dashboard analytics layout can display it cleanly
        res.json({ 
            logs, 
            employeeList, 
            absenceReports, 
            currentNotice: currentStoreNotice 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to compile database logs." });
    }
});

// 5. Register New Employee Record (PROTECTED)
app.post('/api/admin/register', adminGuard, async (req, res) => {
    try {
        const { id, name, requiredHours } = req.body;
        if (!id || !name) return res.status(400).json({ success: false, message: "All fields are required." });
        
        const trackingCheck = await Employee.findOne({ id });
        if (trackingCheck) return res.status(400).json({ success: false, message: "ID exists." });
        
        const parsedHours = requiredHours ? parseFloat(requiredHours) : 10;
        
        await Employee.create({ id, name, requiredHours: parsedHours });
        res.json({ success: true, message: `Employee ${name} registered successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database writing error." });
    }
});

// 6. Broadcast New Notice Board Announcement (PROTECTED - NEW FEATURE)
app.post('/api/admin/notice', adminGuard, (req, res) => {
    const { notice } = req.body;
    if (!notice || !notice.trim()) {
        return res.status(400).json({ success: false, message: "Notice text cannot be empty." });
    }
    
    currentStoreNotice = notice;
    res.json({ success: true, message: "Announcement broadcasted successfully!" });
});

app.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));