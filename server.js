const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser'); // 📱 Added: Essential for device anti-cheat token tracking
const path = require('path');
const mongoose = require('mongoose'); // Upgraded: Removed 'fs', added database engine

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser()); // 📱 Added: Enables cookie parsing for security checking
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// CONNECT TO MONGO_DB CLOUD VAULT
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/de_chis_store";

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log("Connected securely to MongoDB Database Vault!");
        seedInitialEmployees(); // Seeds original staff if database is empty
    })
    .catch(err => console.error("Database connection failure:", err));

// ==========================================
// DEFINING PERMANENT SCHEMAS (VAULT STRUCTURES)
// ==========================================
// 🕒 UPGRADED: Added requiredHours directly to the employee profile structure
const employeeSchema = new mongoose.Schema({ 
    id: String, 
    name: String,
    requiredHours: { type: Number, default: 10 } // Automatically defaults to 10 if not specified
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
    deviceToken: String // 📱 Added: Tracks unique phone footprint to stop buddy clock-ins
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

// Helper function to seed original employees on a brand-new database setup
async function seedInitialEmployees() {
    const count = await Employee.countDocuments();
    if (count === 0) {
        await Employee.insertMany([
            { id: "EMP001", name: "John Doe", requiredHours: 10 },
            { id: "EMP002", name: "Blessing Okafor", requiredHours: 10 },
            { id: "EMP003", name: "Amara Musa", requiredHours: 10 }
        ]);
        console.log("Initial default staff records successfully seeded.");
    }
}

// ==========================================
// ⚙️ SYSTEM CONFIGURATIONS (PRESERVED ACCURATELY)
// ==========================================
const CUTOFF_TIME = "21:00";   
const MAX_DISTANCE_KM = 0.5;   
const STORE_LAT = 9.852912;     
const STORE_LON = 8.853000;     

// Geolocation calculation helper
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
// 📡 ASYNC UPGRADED API ENDPOINTS
// ==========================================

// 1. Fetch Employee Live Status for Dynamic UI Buttons
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

// 2. Process Employee Clocking Actions (WITH PERSONALIZED SHIFT SHIELD)
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

        // 📱 ANTI-CHEAT: Check for or assign browser tracking fingerprint
        let deviceToken = req.cookies.de_chis_device_token;
        let log = await AttendanceLog.findOne({ id: employeeId, date: today });

        if (action === 'checkin') {
            if (log) return res.status(400).json({ success: false, message: "Already checked in today." });
            if (currentTimeString > CUTOFF_TIME) return res.status(400).json({ success: false, message: `Late! Cutoff was ${CUTOFF_TIME}.` });

            // 📱 Guard against multiple accounts using one phone on the same day
            if (deviceToken) {
                const deviceAlreadyUsedToday = await AttendanceLog.findOne({ date: today, deviceToken: deviceToken });
                if (deviceAlreadyUsedToday) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "Security Alert: This phone has already clocked in a worker today. Fraudulent tracking blocked!" 
                    });
                }
            } else {
                // Drop a permanent unique fingerprint cookie onto the worker's mobile device
                deviceToken = 'chis_device_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
                res.cookie('de_chis_device_token', deviceToken, { 
                    maxAge: 2 * 365 * 24 * 60 * 60 * 1000, 
                    httpOnly: true,
                    sameSite: 'lax'
                });
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
            
            // 🕒 DYNAMIC CHECK: Look up this specific employee's allocated shift configuration
            const employeeTargetHours = employee.requiredHours || 10;
            
            if (parseFloat(hoursWorked) < employeeTargetHours) {
                log.flagged = true;
                await log.save();
                return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed, but flagged for leaving early (${hoursWorked}/${employeeTargetHours} hours required).` });
            }

            await log.save();
            return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed (${hoursWorked} hours).` });
        }
    } catch (err) {
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
        
        // 🌟 SAFETY LINK: Returns employeeList under multiple names so your original frontend won't break!
        res.json({ 
            logs, 
            employeeList, 
            employees: employeeList, 
            workers: employeeList, 
            absenceReports 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to compile database logs." });
    }
});

// 5. Register New Employee Record via Admin Panel (WITH SHIFT HOURS ASSIGNMENT)
app.post('/api/admin/register', async (req, res) => {
    try {
        // 🕒 UPGRADED: Destructures the dynamic shift hours value sent directly from admin.html
        const { id, name, requiredHours } = req.body;
        if (!id || !name) return res.status(400).json({ success: false, message: "All fields are required." });
        
        const trackingCheck = await Employee.findOne({ id });
        if (trackingCheck) return res.status(400).json({ success: false, message: "ID exists." });
        
        // Formulate valid float configuration number or default cleanly back to 10
        const parsedHours = requiredHours ? parseFloat(requiredHours) : 10;
        
        await Employee.create({ id, name, requiredHours: parsedHours });
        res.json({ success: true, message: `Employee ${name} registered successfully with a ${parsedHours}-hour shift rule.` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database registration failure." });
    }
});

app.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));