// DE CHIS STORES - Core Cloud Portal Backend Engine
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path'); 
const fs = require('fs'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// MONGODB ATLAS SCHEMAS & CONFIGURATIONS
// ==========================================

const employeeSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    shiftHours: { type: Number, default: 10 } 
});

const attendanceSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    checkInTime: { type: Date, required: true },
    checkOutTime: { type: Date, default: null },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 }
});

const absenceSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    reason: { type: String, required: true },
    filedAt: { type: Date, default: Date.now }
});

const noticeSchema = new mongoose.Schema({
    notice: { type: String, default: "Welcome to DE Chis Stores Portal!" }
});

const Employee = mongoose.model('Employee', employeeSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const Absence = mongoose.model('Absence', absenceSchema);
const Notice = mongoose.model('Notice', noticeSchema);

// Seeds fallback accounts if database is empty on initialization
async function runSystemSeedingEngine() {
    try {
        const checkSeed = await Employee.findOne({ employeeId: "EMP001" });
        if (!checkSeed) {
            await Employee.create({ employeeId: "EMP001", name: "Chisom", shiftHours: 10 });
            await Employee.create({ employeeId: "EMP002", name: "John", shiftHours: 10 });
            await Employee.create({ employeeId: "EMP003", name: "Blessing", shiftHours: 10 });
            console.log("🌱 [SEED ENGINE]: Roster profiles mapped and synchronized.");
        }
    } catch (err) {
        console.error("❌ Seed core generation delayed:", err.message);
    }
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/de_chis_stores')
    .then(function() {
        console.log('🚀 Connected to DE CHIS STORES Live MongoDB Production Cluster');
        runSystemSeedingEngine();
    })
    .catch(function(err) {
        console.error('❌ Connection Failure in MongoDB Engine:', err);
    });

// ==========================================
// ADMIN DASHBOARD CORE PIPELINE ENDPOINTS
// ==========================================

// GET: Aggregates stats, formatting streams to match your precise table rows
app.get('/api/admin/data', async function(req, res) {
    try {
        const employees = await Employee.find().lean();
        const attendance = await Attendance.find().sort({ checkInTime: -1 }).lean();
        const absences = await Absence.find().sort({ filedAt: -1 }).lean();
        const currentNoticeDoc = await Notice.findOne();
        const currentNoticeText = currentNoticeDoc ? currentNoticeDoc.notice : "Welcome to DE Chis Stores Portal!";

        // 1. Map to match: e.id, e.name
        const employeeList = employees.map(e => ({
            id: e.employeeId,
            name: e.name
        }));

        // Dictionary to perform high-speed lookups for table joints
        const empMap = {};
        employees.forEach(e => {
            empMap[e.employeeId] = { name: e.name, requiredHours: e.shiftHours || 10 };
        });

        // 2. Map to match: l.date, l.id, l.name, l.checkIn, l.checkOut, l.hoursWorked, l.flagged
        const logs = attendance.map(l => {
            const empInfo = empMap[l.employeeId] || { name: "Unknown Worker", requiredHours: 10 };
            const checkInDate = new Date(l.checkInTime);
            
            // Adjust to display clean local strings
            const dateStr = checkInDate.toISOString().split('T')[0];
            const checkInStr = checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            let checkOutStr = null;
            let hoursWorked = null;
            let flagged = false;

            if (l.checkOutTime) {
                const checkOutDate = new Date(l.checkOutTime);
                checkOutStr = checkOutDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                hoursWorked = ((checkOutDate - checkInDate) / (1000 * 60 * 60)).toFixed(2);
                
                // Flag rule engine if worker logs out earlier than assigned shift configuration
                if (parseFloat(hoursWorked) < empInfo.requiredHours) {
                    flagged = true;
                }
            }

            return {
                date: dateStr,
                id: l.employeeId,
                name: empInfo.name,
                checkIn: checkInStr,
                checkOut: checkOutStr,
                hoursWorked: hoursWorked,
                flagged: flagged
            };
        });

        // 3. Map to match: a.date, a.id, a.name, a.reason, a.submittedAt
        const absenceReports = absences.map(a => {
            const empInfo = empMap[a.employeeId] || { name: "Unknown Worker" };
            const filedDate = new Date(a.filedAt);
            return {
                date: filedDate.toISOString().split('T')[0],
                id: a.employeeId,
                name: empInfo.name,
                reason: a.reason,
                submittedAt: filedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
        });

        // Formatted package object sent down the line to client
        return res.json({
            employeeList: employeeList,
            logs: logs,
            absenceReports: absenceReports,
            currentNotice: currentNoticeText
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST: Handles worker submission from dashboard
app.post('/api/admin/register', async function(req, res) {
    try {
        const { id, name, requiredHours } = req.body;
        if (!id || !name) {
            return res.status(400).json({ success: false, message: "Error: Parameters are completely empty!" });
        }

        const existing = await Employee.findOne({ employeeId: id });
        if (existing) {
            return res.status(400).json({ success: false, message: "Database Warning: Employee ID signature already assigned!" });
        }

        await Employee.create({
            employeeId: id,
            name: name,
            shiftHours: requiredHours ? parseFloat(requiredHours) : 10
        });

        return res.json({ success: true, message: "System Log: Employee added to roster index files successfully!" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST: Overwrites announcement record state strings
app.post('/api/admin/notice', async function(req, res) {
    try {
        const { notice } = req.body;
        let currentNotice = await Notice.findOne();
        if (!currentNotice) {
            currentNotice = new Notice();
        }
        currentNotice.notice = notice;
        await currentNotice.save();
        return res.json({ success: true, message: "Notice broadcast configurations synced globally!" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// WORKERS APPLICATION UTILITY ENDPOINTS
// ==========================================

app.get('/api/notice', async function(req, res) {
    try {
        let currentNotice = await Notice.findOne();
        return res.json({ notice: currentNotice ? currentNotice.notice : "Welcome to DE Chis Stores Portal!" });
    } catch (err) {
        return res.json({ notice: "Welcome to DE Chis Stores Portal!" });
    }
});

app.get('/api/attendance/status/:id', async function(req, res) {
    try {
        const id = req.params.id;
        const employee = await Employee.findOne({ employeeId: id });
        if (!employee) return res.json({ status: "unregistered" });

        const activeShift = await Attendance.findOne({ employeeId: id, checkOutTime: null });
        if (activeShift) {
            return res.json({
                status: "checked_in",
                name: employee.name,
                checkInTime: new Date(activeShift.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                checkInTimeRaw: activeShift.checkInTime, 
                shiftHours: employee.shiftHours || 10   
            });
        }

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const completedShiftToday = await Attendance.findOne({
            employeeId: id,
            checkInTime: { $gte: startOfToday },
            checkOutTime: { $ne: null }
        });

        if (completedShiftToday) return res.json({ status: "completed" });
        return res.json({ status: "not_checked_in" });
    } catch (err) {
        return res.status(500).json({ error: "Verification processing error." });
    }
});

app.post('/api/attendance', async function(req, res) {
    try {
        const { employeeId, action, lat, lon } = req.body;
        const employee = await Employee.findOne({ employeeId: employeeId });
        if (!employee) return res.status(403).json({ success: false, message: "Punch Denied: Profile ID missing." });
        
        if (action === 'checkin') {
            const newShift = new Attendance({ employeeId: employeeId, checkInTime: new Date(), latitude: lat, longitude: lon });
            await newShift.save();
            return res.json({ success: true, message: "Shift punched and logged successfully." });
        } 
        
        if (action === 'checkout') {
            const activeShift = await Attendance.findOne({ employeeId: employeeId, checkOutTime: null });
            if (!activeShift) return res.json({ success: false, message: "No active session located." });
            activeShift.checkOutTime = new Date();
            await activeShift.save();
            return res.json({ success: true, message: "Shift finalized." });
        }
        return res.status(400).json({ success: false, message: "Invalid transactional signature." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/absence-report', async function(req, res) {
    try {
        const { employeeId, reason } = req.body;
        const employee = await Employee.findOne({ employeeId: employeeId });
        if (!employee) return res.json({ success: false, message: "Ticket Denied: ID not recognized." });

        const newTicket = new Absence({ employeeId: employeeId, reason: reason });
        await newTicket.save();
        return res.json({ success: true, message: "Absence Ticket routed smoothly." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Database transmission delay." });
    }
});

// Catch-all route definitions to handle clean standalone page decoupling
app.get('/', function(req, res) {
    const mainPaths = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')];
    for (let p of mainPaths) { if (fs.existsSync(p)) return res.sendFile(p); }
    res.status(404).send("Error: index.html missing from public directory.");
});

app.get('/admin.html', function(req, res) {
    const adminPaths = [path.join(__dirname, 'public', 'admin.html'), path.join(__dirname, 'admin.html')];
    for (let p of adminPaths) { if (fs.existsSync(p)) return res.sendFile(p); }
    res.status(404).send("Error: admin.html layout template missing.");
});

app.listen(PORT, function() {
    console.log(`📡 DE CHIS Operational Grid Core broadcast active on port: ${PORT}`);
});