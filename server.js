const express = require('express');
const path = require('path');
const mongoose = require('mongoose'); // Import Mongoose
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// ========================================================
// MONGODB CONNECTION SETUP
// ========================================================
const MONGO_URI = process.env.MONGODB_URI || "your_fallback_mongodb_connection_string_here";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✔️ [SUCCESS] Connected securely to MongoDB Atlas database"))
    .catch((err) => console.error("❌ [DATABASE ERROR] Failed to connect to MongoDB:", err));

// ========================================================
// DATABASE SCHEMAS & MODELS
// ========================================================
const EmployeeSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    role: { type: String, default: "Staff Member" },
    shiftHours: { type: Number, default: 8 },
    cutoffHour: { type: Number, default: 8 },
    cutoffMinute: { type: Number, default: 0 }
});
const Employee = mongoose.model('Employee', EmployeeSchema);

const AttendanceLogSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, uppercase: true },
    status: { type: String, default: 'checked_in' }, // 'checked_in' or 'completed'
    deviceId: { type: String, required: true },
    checkInTimeRaw: { type: Date, default: Date.now },
    checkInTimeFormatted: { type: String, required: true },
    checkOutTimeRaw: { type: Date }
});
const AttendanceLog = mongoose.model('AttendanceLog', AttendanceLogSchema);

const AbsenceReportSchema = new mongoose.Schema({
    date: { type: String, required: true },
    employeeId: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    reason: { type: String, required: true },
    submittedAt: { type: String, required: true }
});
const AbsenceReport = mongoose.model('AbsenceReport', AbsenceReportSchema);

const NoticeSchema = new mongoose.Schema({
    noticeText: { type: String, default: "Welcome to DE CHIS STORES Portal! Please check in according to your designated shift schedule." }
});
const Notice = mongoose.model('Notice', NoticeSchema);

// Helper function to get or initialize the notice
async function getNoticeText() {
    let noticeObj = await Notice.findOne();
    if (!noticeObj) {
        noticeObj = await Notice.create({ noticeText: "Welcome to DE CHIS STORES Portal! Please check in according to your designated shift schedule." });
    }
    return noticeObj.noticeText;
}

// ========================================================
// SECURE VALIDATION ENGINES
// ========================================================
const STORE_COORDS = { lat: 9.852923, lon: 8.852990 }; 
const MAX_DISTANCE_METERS = 100; 

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

function isPastEmployeeCutoff(employee) {
    const now = new Date();
    const currentTotalMinutes = (now.getHours() * 60) + now.getMinutes();
    const cutoffTotalMinutes = (employee.cutoffHour * 60) + employee.cutoffMinute;
    return currentTotalMinutes >= cutoffTotalMinutes;
}

// ========================================================
// FOLDER PATH CORRECTION
// ========================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// ========================================================
// API ROUTERS / ENDPOINTS (CONVERTED TO MONGOOSE)
// ========================================================

// 1. ADMIN DATA PANEL FEED
app.get('/api/admin/data', async (req, res) => {
    try {
        const employeeList = await Employee.find({});
        const activeLogs = await AttendanceLog.find({});
        const absenceList = await AbsenceReport.find({});
        const activeNotice = await getNoticeText();

        const logsPayload = activeLogs.map(log => {
            const emp = employeeList.find(e => e.id === log.employeeId) || { name: "Unknown Staff", shiftHours: 8 };
            const isLate = log.checkInTimeRaw && isPastEmployeeCutoff(emp);
            const rawDate = log.checkInTimeRaw ? new Date(log.checkInTimeRaw) : new Date();

            return {
                date: rawDate.toISOString().split('T')[0],
                id: log.employeeId,
                name: emp.name,
                checkIn: log.checkInTimeFormatted || '--:--',
                checkOut: log.status === 'completed' ? 'Finalized' : null,
                hoursWorked: emp.shiftHours || 8,
                flagged: isLate
            };
        });

        res.json({
            employeeList: employeeList,
            logs: logsPayload,
            absenceReports: absenceList,
            currentNotice: activeNotice
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database read error." });
    }
});

// 2. BROADCAST NOTICE
app.post('/api/admin/notice', async (req, res) => {
    try {
        if (req.body.notice) {
            await Notice.findOneAndUpdate({}, { noticeText: req.body.notice }, { upsert: true });
            return res.json({ success: true, message: "Notice successfully saved to database!" });
        }
        res.status(400).json({ success: false, message: "Notice parameter missing." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Notice database update failed." });
    }
});

// 3. REGISTER STAFF PROFILE
app.post(['/api/employees', '/api/admin/register'], async (req, res) => {
    try {
        const { id, name, requiredHours, shiftHours, cutoffHour, cutoffMinute } = req.body;
        
        if (!id || !name) {
            return res.status(400).json({ success: false, message: "Missing ID or Name parameters." });
        }
        
        const targetId = id.toUpperCase();
        const hours = parseInt(shiftHours) || parseInt(requiredHours) || 8;

        const updatedEmployee = await Employee.findOneAndUpdate(
            { id: targetId },
            {
                id: targetId,
                name: name,
                role: "Staff Member",
                shiftHours: hours,
                cutoffHour: cutoffHour !== undefined && cutoffHour !== "" ? parseInt(cutoffHour) : 8,
                cutoffMinute: cutoffMinute !== undefined && cutoffMinute !== "" ? parseInt(cutoffMinute) : 0
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: `Profile registered for ${updatedEmployee.name} [${targetId}] in MongoDB!` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database write error during registration." });
    }
});

// 4. NOTICE GETTER FOR HOMEPAGE
app.get('/api/notice', async (req, res) => {
    const activeNotice = await getNoticeText();
    res.json({ notice: activeNotice });
});

// 5. GET COMPACT ACTIVE COUNT
app.get('/api/attendance/active-count', async (req, res) => {
    const count = await AttendanceLog.countDocuments({ status: 'checked_in' });
    res.json({ count });
});

// 6. LIVE SESSION CHECK FOR USERS
app.get('/api/attendance/status/:id', async (req, res) => {
    try {
        const id = req.params.id.toUpperCase();
        const employee = await Employee.findOne({ id });
        
        if (!employee) {
            return res.json({ status: "unregistered" });
        }

        const currentLog = await AttendanceLog.findOne({ employeeId: id, status: 'checked_in' });
        if (!currentLog) {
            return res.json({ status: "not_checked_in" });
        }

        if (isPastEmployeeCutoff(employee)) {
            currentLog.status = 'completed';
            await currentLog.save();
            return res.json({ status: "completed" });
        }

        res.json({
            status: currentLog.status,
            name: employee.name,
            checkInTime: currentLog.checkInTimeFormatted,
            shiftHours: employee.shiftHours
        });
    } catch (err) {
        res.status(500).json({ status: "error" });
    }
});

// 7. SECURE SIGN IN/OUT PROCESSOR
app.post('/api/attendance', async (req, res) => {
    try {
        const { employeeId, action, lat, lon, deviceId } = req.body;
        const id = employeeId.toUpperCase();

        const employee = await Employee.findOne({ id });
        if (!employee) return res.status(400).json({ success: false, message: "ID unregistered in database." });

        if (!lat || !lon) return res.status(400).json({ success: false, message: "Access Denied: GPS missing." });
        const distance = calculateDistance(lat, lon, STORE_COORDS.lat, STORE_COORDS.lon);
        if (distance > MAX_DISTANCE_METERS) {
            return res.status(403).json({ success: false, message: `Outside store boundaries.` });
        }

        if (action === 'checkin' && isPastEmployeeCutoff(employee)) {
            const formattedCutoff = `${String(employee.cutoffHour).padStart(2, '0')}:${String(employee.cutoffMinute).padStart(2, '0')}`;
            return res.status(403).json({ success: false, message: `Check-in window closed at ${formattedCutoff}.` });
        }

        if (action === 'checkin') {
            if (!deviceId) return res.status(400).json({ success: false, message: "Device fingerprint missing." });
            const fraudDeviceMatch = await AttendanceLog.findOne({ deviceId: deviceId, status: 'checked_in', employeeId: { $ne: id } });
            if (fraudDeviceMatch) return res.status(403).json({ success: false, message: "Fraud Protection: Device already active for another staff." });
        }

        const now = new Date();
        if (action === 'checkin') {
            await AttendanceLog.create({
                employeeId: id,
                status: 'checked_in',
                deviceId: deviceId,
                checkInTimeRaw: now,
                checkInTimeFormatted: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            return res.json({ success: true, message: `Welcome on shift, ${employee.name}.` });
        } else if (action === 'checkout') {
            const activeLog = await AttendanceLog.findOne({ employeeId: id, status: 'checked_in' });
            if (!activeLog) return res.status(400).json({ success: false, message: "No active session." });
            
            activeLog.status = 'completed';
            activeLog.checkOutTimeRaw = now;
            await activeLog.save();
            return res.json({ success: true, message: "Shift finalized safely!" });
        }
        res.status(400).json({ success: false, message: "System anomaly." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database transaction failed." });
    }
});

// 8. DELETE STAFF MEMBER
app.delete('/api/employees/:id', async (req, res) => {
    try {
        const id = req.params.id.toUpperCase();
        const deleted = await Employee.findOneAndDelete({ id });
        if (deleted) {
            await AttendanceLog.deleteMany({ employeeId: id });
            return res.json({ success: true, message: "Staff records wiped from database." });
        }
        res.status(404).json({ success: false, message: "ID not found." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to drop staff record." });
    }
});

// 9. ABSENCE SUBMISSIONS
app.post('/api/absence-report', async (req, res) => {
    try {
        const { employeeId, reason } = req.body;
        const id = employeeId.toUpperCase();
        
        const employee = await Employee.findOne({ id });
        if (!employee) return res.status(400).json({ success: false, message: "ID unregistered." });
        
        const report = await AbsenceReport.create({
            date: new Date().toISOString().split('T')[0],
            employeeId: id,
            name: employee.name,
            reason: reason,
            submittedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        
        res.json({ success: true, message: "Absence ticket logged in MongoDB!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Could not log absence ticket." });
    }
});

app.listen(PORT, () => {
    console.log(`[DE CHIS STORES PORTAL ENGINE LIVE AND DB ATTACHED ON PORT ${PORT}]`);
});