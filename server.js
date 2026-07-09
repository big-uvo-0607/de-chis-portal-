// DE CHIS STORES - Core Cloud Portal Backend Engine
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/de_chis_stores')
    .then(() => console.log('🚀 Connected to DE CHIS STORES Live MongoDB Production Cluster'))
    .catch(err => console.error('❌ Connection Failure in MongoDB Engine:', err));


// ==========================================
// PORTAL API OPERATIONAL ENDPOINTS
// ==========================================

app.get('/api/attendance/active-count', async (req, res) => {
    try {
        const activeCount = await Attendance.countDocuments({ checkOutTime: null });
        res.json({ count: activeCount });
    } catch (err) {
        res.status(500).json({ count: 0, error: err.message });
    }
});

app.get('/api/attendance/status/:id', async (req, res) => {
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
        startOfToday.setHours(0,0,0,0);
        
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
        res.status(500).json({ error: "Internal core verification system fault." });
    }
});

app.post('/api/attendance', async (req, res) => {
    try {
        const { employeeId, action, lat, lon } = req.body;
        
        if (action === 'checkin') {
            const newShift = new Attendance({
                employeeId,
                checkInTime: new Date(),
                latitude: lat,
                longitude: lon
            });
            await newShift.save();
            return res.json({ success: true, message: "Shift punched and logged successfully into cloud repository." });
        } 
        
        if (action === 'checkout') {
            const activeShift = await Attendance.findOne({ employeeId, checkOutTime: null });
            if (!activeShift) {
                return res.json({ success: false, message: "No active workspace session found for this ID." });
            }
            
            activeShift.checkOutTime = new Date();
            await activeShift.save();
            return res.json({ success: true, message: "Shift finalized. Workspace log stored safely." });
        }

        res.status(400).json({ success: false, message: "Invalid system transactional signature." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/absence-report', async (req, res) => {
    try {
        const { employeeId, reason } = req.body;
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.json({ success: false, message: "Ticket Denied: Assignment ID not recognized." });
        }

        const newTicket = new Absence({ employeeId, reason });
        await newTicket.save();
        res.json({ success: true, message: "Absence Ticket routed smoothly to store administrative office." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Database transmission delay. Try again." });
    }
});

app.delete('/api/employees/:employeeId', async (req, res) => {
    try {
        const id = req.params.employeeId;
        const targetProfile = await Employee.findOne({ employeeId: id });
        if (!targetProfile) {
            return res.json({ success: false, message: "Operation Aborted: Profile ID not located inside directory." });
        }

        await Employee.deleteOne({ employeeId: id });
        await Attendance.deleteMany({ employeeId: id, checkOutTime: null });
        res.json({ success: true, message: `Profile execution complete: ${id} scrubbed from cloud server environment.` });
    } catch (err) {
        res.status(500).json({ success: false, message: "Administrative override terminal network failure." });
    }
});

app.get('/api/notice', async (req, res) => {
    try {
        let currentNotice = await Notice.findOne();
        if (!currentNotice) {
            currentNotice = new Notice();
            await currentNotice.save();
        }
        res.json({ notice: currentNotice.notice });
    } catch (err) {
        res.json({ notice: "Welcome to DE Chis Stores Portal!" });
    }
});

// Catch-All Routing Interface Delivery (Fully compatible with Express 4)
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/index.html'); 
});

app.listen(PORT, () => {
    console.log(`📡 DE CHIS Operational Grid Core broadcast active on port: ${PORT}`);
});