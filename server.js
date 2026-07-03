const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser'); // 📱 Added to read device fingerprints
const path = require('path');
const mongoose = require('mongoose'); // 🗄️ Upgraded: MongoDB database engine

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser()); // 📱 Activates cookie device-tracking system
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 🗄️ CONNECT TO MONGO_DB CLOUD VAULT
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/de_chis_store";

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log("Connected securely to MongoDB Database Vault!");
        seedInitialEmployees(); // Seeds your original staff if database is empty
    })
    .catch(err => console.error("Database connection failure:", err));

// ==========================================
// 📋 DEFINING PERMANENT DATABASE VAULT STRUCTURES
// ==========================================
const employeeSchema = new mongoose.Schema({ id: String, name: String });
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
    deviceToken: String // 📱 Stores the unique device fingerprint for this log
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

// 🔒 PRESERVED: Your original core staff array
async function seedInitialEmployees() {
    const count = await Employee.countDocuments();
    if (count === 0) {
        await Employee.insertMany([
            { id: "EMP001", name: "John Doe" },
            { id: "EMP002", name: "Blessing Okafor" },
            { id: "EMP003", name: "Amara Musa" }
        ]);
        console.log("Initial default staff records successfully seeded.");
    }
}

// ==========================================
// ⚙️ PRESERVED SYSTEM CONFIGURATIONS
// ==========================================
const CUTOFF_TIME = "21:00";   
const REQUIRED_HOURS = 10;     
const MAX_DISTANCE_KM = 0.5;   
const STORE_LAT = 9.852912;     
const STORE_LON = 8.853000;     

// 🔒 PRESERVED: Your precise location calculation engine
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

// ==========================================
// 📡 UPGRADED DATABASE API ENDPOINTS
// ==========================================

// 1. Fetch Employee Live Status for UI Buttons
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
        res.status(500).json({ success: false, message: "Server error checking status." });
    }
});

// 2. Process Employee Clocking Actions (WITH DEVICE LOCK ANTI-FRAUD)
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

        // 📱 Grab the device tracking token from browser cookies if it exists
        let deviceToken = req.cookies.de_chis_device_token;

        let log = await AttendanceLog.findOne({ id: employeeId, date: today });

        if (action === 'checkin') {
            if (log) return res.status(400).json({ success: false, message: "Already checked in today." });
            if (currentTimeString > CUTOFF_TIME) return res.status(400).json({ success: false, message: `Late! Cutoff was ${CUTOFF_TIME}.` });

            // 📱 ANTI-CHEAT CHECK: Block device if already used by a friend today
            if (deviceToken) {
                const deviceAlreadyUsedToday = await AttendanceLog.findOne({ date: today, deviceToken: deviceToken });
                if (deviceAlreadyUsedToday) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "Security Alert: This device has already checked in a worker today. You cannot check in for friends!" 
                    });
                }
            } else {
                // Generate a brand new unique digital fingerprint signature for this phone
                deviceToken = 'dev_phone_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
                
                // Drop the cookie cookie into their browser settings (lasts for 2 years)
                res.cookie('de_chis_device_token', deviceToken, { 
                    maxAge: 2 * 365 * 24 * 60 * 60 * 1000, 
                    httpOnly: true,
                    sameSite: 'lax'
                });
            }

            // Save the log linked to this phone's device signature
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
            
            if (parseFloat(hoursWorked) < REQUIRED_HOURS) {
                log.flagged = true;
                await log.save();
                return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed, but flagged for leaving early (${hoursWorked}/${REQUIRED_HOURS} hours).` });
            }

            await log.save();
            return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed (${hoursWorked} hours).` });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server encountered a clocking error." });
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
        res.status(500).json({ success: false, message: "Server error reporting absence." });
    }
});

// 4. Fetch Master Matrix Logs for Admin Dashboard Panels
app.get('/api/admin/data', async (req, res) => {
    try {
        const logs = await AttendanceLog.find({});
        const employeeList = await Employee.find({});
        const absenceReports = await AbsenceReport.find({});
        
        res.json({ logs, employeeList, absenceReports });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to compile database logs." });
    }
});

// 5. Register New Employee Record via Admin Panel
app.post('/api/admin/register', async (req, res) => {
    try {
        const { id, name } = req.body;
        if (!id || !name) return res.status(400).json({ success: false, message: "All fields are required." });
        
        const trackingCheck = await Employee.findOne({ id });
        if (trackingCheck) return res.status(400).json({ success: false, message: "ID exists." });
        
        await Employee.create({ id, name });
        res.json({ success: true, message: "Employee registered successfully." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database registration failure." });
    }
});

app.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));