// DE CHIS STORES - Core Cloud Portal Backend Engine
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path'); // Handles system-agnostic folder paths
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Universal Middleware Layout
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

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

// Self-Executing System Developer Seed Block
async function runSystemSeedingEngine() {
    try {
        const checkSeed = await Employee.findOne({ employeeId: "EMP001" });
        if (!checkSeed) {
            await Employee.create({
                employeeId: "EMP001",
                name: "Chisom",
                shiftHours: 10
            });
            console.log("🌱 [SEED ENGINE]: Local deployment target profile verified & inserted (EMP001).");
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

app.get('/api/attendance/status/:id', async function(req, res) {
    try {
        const id = req.params.id;
        const employee = await Employee.findOne({ employeeId: id });
        if (!employee) {
            return res.json({ status: "unregistered" });
        }

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

        if (completedShiftToday) {
            return res.json({ status: "completed" });
        }

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
        if (!employee) {
            return res.status(403).json({ success: false, message: "Punch Denied: Profile ID missing from local directory." });
        }
        
        if (action === 'checkin') {
            const newShift = new Attendance({
                employeeId: employeeId,
                checkInTime: new Date(),
                latitude: lat,
                longitude: lon
            });
            await newShift.save();
            return res.json({ success: true, message: "Shift punched and logged successfully into cloud repository." });
        } 
        
        if (action === 'checkout') {
            const activeShift = await Attendance.findOne({ employeeId: employeeId, checkOutTime: null });
            if (!activeShift) {
                return res.json({ success: false, message: "No active workspace session found for this ID." });
            }
            
            activeShift.checkOutTime = new Date();
            await activeShift.save();
            return res.json({ success: true, message: "Shift finalized. Workspace log stored safely." });
        }

        return res.status(400).json({ success: false, message: "Invalid system transactional signature." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/absence-report', async function(req, res) {
    try {
        const employeeId = req.body.employeeId;
        const reason = req.body.reason;
        
        const employee = await Employee.findOne({ employeeId: employeeId });
        if (!employee) {
            return res.json({ success: false, message: "Ticket Denied: Assignment ID not recognized." });
        }

        const newTicket = new Absence({ employeeId: employeeId, reason: reason });
        await newTicket.save();
        return res.json({ success: true, message: "Absence Ticket routed smoothly to store administrative office." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Database transmission delay. Try again." });
    }
});

app.delete('/api/employees/:employeeId', async function(req, res) {
    try {
        const id = req.params.employeeId;
        const targetProfile = await Employee.findOne({ employeeId: id });
        if (!targetProfile) {
            return res.json({ success: false, message: "Operation Aborted: Profile ID not located inside directory." });
        }

        await Employee.deleteOne({ employeeId: id });
        await Attendance.deleteMany({ employeeId: id, checkOutTime: null });
        return res.json({ success: true, message: `Profile execution complete: ${id} scrubbed from cloud server environment.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Administrative override terminal network failure." });
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

// Catch-All Interface Loader mapped safely using absolute Linux paths
app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html')); 
});

app.listen(PORT, function() {
    console.log(`📡 DE CHIS Operational Grid Core broadcast active on port: ${PORT}`);
});