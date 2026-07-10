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
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
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
// PORTAL API OPERATIONAL ENDPOINTS
// ==========================================

app.get('/api/attendance/active-count', async function(req, res) {
    try {
        const activeCount = await Attendance.countDocuments({ checkOutTime: null });
        return res.json({ count: activeCount });
    } catch (err) {
        return res.status(500).json({ count: 0, error: err.message });
    }
});

// Admin-facing Management Registry Fetcher (Feeds the visual directory table)
app.get('/api/management/employees', async function(req, res) {
    try {
        const employees = await Employee.find().lean();
        const activeShifts = await Attendance.find({ checkOutTime: null }).select('employeeId');
        const activeIds = activeShifts.map(shift => shift.employeeId);
        
        const mappedRoster = employees.map(emp => {
            emp.hasActiveShift = activeIds.includes(emp.employeeId);
            return emp;
        });
        
        return res.json(mappedRoster);
    } catch(err) {
        return res.status(500).json({ error: err.message });
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
        return res.status(500).json({ error: "Internal core verification system fault." });
    }
});

app.post('/api/attendance', async function(req, res) {
    try {
        const employeeId = req.body.employeeId;
        const action = req.body.action;
        const lat = req.body.lat;
        const lon = req.body.lon;
        
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
        const employeeId = req.body.employeeId;
        const reason = req.body.reason;
        const employee = await Employee.findOne({ employeeId: employeeId });
        if (!employee) return res.json({ success: false, message: "Ticket Denied: ID not recognized." });

        const newTicket = new Absence({ employeeId: employeeId, reason: reason });
        await newTicket.save();
        return res.json({ success: true, message: "Absence Ticket routed smoothly." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Database transmission delay." });
    }
});

app.delete('/api/employees/:employeeId', async function(req, res) {
    try {
        const id = req.params.employeeId;
        const targetProfile = await Employee.findOne({ employeeId: id });
        if (!targetProfile) return res.json({ success: false, message: "Operation Aborted: Profile ID not located." });

        await Employee.deleteOne({ employeeId: id });
        await Attendance.deleteMany({ employeeId: id, checkOutTime: null });
        return res.json({ success: true, message: `Profile execution complete.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Administrative override terminal failure." });
    }
});

app.get('/api/notice', async function(req, res) {
    try {
        let currentNotice = await Notice.findOne();
        if (!currentNotice) {
            currentNotice = new Notice();
            await currentNotice.save();
        }
        return res.json({ notice: currentNotice.notice });
    } catch (err) {
        return res.json({ notice: "Welcome to DE Chis Stores Portal!" });
    }
});

app.post('/api/notice', async function(req, res) {
    try {
        const incomingText = req.body.notice;
        let currentNotice = await Notice.findOne();
        if (!currentNotice) currentNotice = new Notice();
        currentNotice.notice = incomingText;
        await currentNotice.save();
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// DEDICATED SEPARATE PAGE ROUTING ENGINE
// ==========================================

app.get('/', function(req, res) {
    const mainPaths = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')];
    for (let p of mainPaths) { if (fs.existsSync(p)) return res.sendFile(p); }
    res.status(404).send("Error: index.html missing.");
});

app.get('/admin.html', function(req, res) {
    const adminPaths = [path.join(__dirname, 'public', 'admin.html'), path.join(__dirname, 'admin.html')];
    for (let p of adminPaths) { if (fs.existsSync(p)) return res.sendFile(p); }
    res.status(404).send("Error: admin.html missing from public folder.");
});

app.listen(PORT, function() {
    console.log(`📡 DE CHIS Operational Grid Core broadcast active on port: ${PORT}`);
});