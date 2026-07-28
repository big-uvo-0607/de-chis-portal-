const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 5000;

// Body parsing with size limits to prevent payload abuse
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ========================================================
// GLOBAL CRASH SHIELDS (PREVENT SERVER CRASHES)
// ========================================================
process.on('uncaughtException', (err) => {
    console.error('❌ [CRITICAL UNCAUGHT EXCEPTION]:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [UNHANDLED PROMISE REJECTION]:', reason);
});

// ========================================================
// MONGODB CONNECTION SETUP
// ========================================================
const MONGO_URI = process.env.MONGODB_URI || "your_fallback_mongodb_connection_string_here";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✔️ [SUCCESS] Connected securely to MongoDB Atlas database"))
    .catch((err) => console.error("❌ [DATABASE ERROR] Failed to connect to MongoDB:", err));

// ========================================================
// LOCAL TIMEZONE HELPERS (NIGERIA / WAT / UTC+1)
// ========================================================
function getFormattedNigerianTime(dateObj = new Date()) {
    return dateObj.toLocaleTimeString('en-US', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function getNigerianDateString(dateObj = new Date()) {
    return new Date(dateObj).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

// ========================================================
// DATABASE SCHEMAS & MODELS
// ========================================================
const EmployeeSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "Staff Member", trim: true },
    shiftHours: { type: Number, default: 10 },
    cutoffHour: { type: Number, default: 8 },
    cutoffMinute: { type: Number, default: 0 },
    // 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
    workDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] }
}, { timestamps: true });

const Employee = mongoose.model('Employee', EmployeeSchema);

const AttendanceLogSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, uppercase: true, trim: true },
    status: { type: String, default: 'checked_in', enum: ['checked_in', 'completed', 'LEFT'] },
    deviceId: { type: String, required: true, trim: true },
    checkInTimeRaw: { type: Date, default: Date.now },
    checkInTimeFormatted: { type: String, required: true },
    checkOutTimeRaw: { type: Date },
    checkOutTimeFormatted: { type: String }
}, { timestamps: true });

const AttendanceLog = mongoose.model('AttendanceLog', AttendanceLogSchema);

const AbsenceReportSchema = new mongoose.Schema({
    date: { type: String, required: true },
    employeeId: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true },
    submittedAt: { type: String, required: true }
}, { timestamps: true });

const AbsenceReport = mongoose.model('AbsenceReport', AbsenceReportSchema);

const NoticeSchema = new mongoose.Schema({
    noticeText: { type: String, default: "Welcome to DE CHIS STORES Portal! Please check in according to your designated shift schedule." }
});

const Notice = mongoose.model('Notice', NoticeSchema);

// Helper function to get or initialize the notice
async function getNoticeText() {
    try {
        let noticeObj = await Notice.findOne();
        if (!noticeObj) {
            noticeObj = await Notice.create({ 
                noticeText: "Welcome to DE CHIS STORES Portal! Please check in according to your designated shift schedule." 
            });
        }
        return noticeObj.noticeText;
    } catch (err) {
        console.error("Notice retrieval error:", err);
        return "Welcome to DE CHIS STORES Portal!";
    }
}

// ========================================================
// SECURE VALIDATION ENGINES
// ========================================================
const STORE_COORDS = { lat: 9.852923, lon: 8.852990 }; 
const MAX_DISTANCE_METERS = 300; 

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
    if (!employee) return false;
    const nowNigeria = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
    const currentTotalMinutes = (nowNigeria.getHours() * 60) + nowNigeria.getMinutes();
    const cutoffTotalMinutes = ((employee.cutoffHour || 8) * 60) + (employee.cutoffMinute || 0);
    return currentTotalMinutes >= cutoffTotalMinutes;
}

function isCheckInLate(checkInDateObj, employee) {
    if (!checkInDateObj || !employee) return false;
    const localCheckInStr = checkInDateObj.toLocaleString("en-US", { timeZone: "Africa/Lagos" });
    const localCheckIn = new Date(localCheckInStr);
    const checkInTotalMinutes = (localCheckIn.getHours() * 60) + localCheckIn.getMinutes();
    const cutoffTotalMinutes = ((employee.cutoffHour || 8) * 60) + (employee.cutoffMinute || 0);
    return checkInTotalMinutes > cutoffTotalMinutes;
}

function isEarlyDeparture(log, employee) {
    if (!log || log.status !== 'completed' || !log.checkInTimeRaw || !log.checkOutTimeRaw || !employee) return false;
    const diffMs = new Date(log.checkOutTimeRaw) - new Date(log.checkInTimeRaw);
    const hoursWorked = diffMs / (1000 * 60 * 60);
    return hoursWorked < (employee.shiftHours || 10);
}

// ========================================================
// STATIC FILE & ROUTE HANDLERS
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
// API ROUTERS / ENDPOINTS
// ========================================================

// 1. ADMIN DATA PANEL FEED
app.get('/api/admin/data', async (req, res) => {
    try {
        const employeeList = await Employee.find({}).lean();
        const activeLogs = await AttendanceLog.find({}).sort({ checkInTimeRaw: -1 }).lean();
        const absenceList = await AbsenceReport.find({}).sort({ createdAt: -1 }).lean();
        const activeNotice = await getNoticeText();

        const logsPayload = activeLogs.map(log => {
            const emp = employeeList.find(e => e.id === log.employeeId) || { name: "Unknown Staff", shiftHours: 10, cutoffHour: 8, cutoffMinute: 0 };
            
            const late = isCheckInLate(log.checkInTimeRaw ? new Date(log.checkInTimeRaw) : null, emp);
            const early = isEarlyDeparture(log, emp);
            const isFlagged = late || early;

            let checkOutDisplay = null;
            if (log.status === 'completed') {
                checkOutDisplay = log.checkOutTimeFormatted || (log.checkOutTimeRaw ? getFormattedNigerianTime(new Date(log.checkOutTimeRaw)) : 'Finalized');
            } else if (log.status === 'LEFT') {
                checkOutDisplay = 'LEFT (SYSTEM RESET)';
            }

            let calculatedHours = emp.shiftHours || 10;
            if (log.checkInTimeRaw && log.checkOutTimeRaw) {
                const diffMs = new Date(log.checkOutTimeRaw) - new Date(log.checkInTimeRaw);
                calculatedHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(1));
            }

            return {
                date: getNigerianDateString(log.checkInTimeRaw || new Date()),
                id: log.employeeId,
                name: emp.name,
                checkIn: log.checkInTimeFormatted || '--:--',
                checkOut: checkOutDisplay,
                hoursWorked: calculatedHours,
                flagged: isFlagged,
                late: late,
                early: early
            };
        });

        res.json({
            employeeList: employeeList,
            logs: logsPayload,
            absenceReports: absenceList,
            currentNotice: activeNotice
        });
    } catch (err) {
        console.error("Admin data fetch failed:", err);
        res.status(500).json({ success: false, message: "Database read error." });
    }
});

// 1B. EMPLOYEE HISTORY & MISSED DAYS ENGINE
app.get('/api/admin/employee-history/:id', async (req, res) => {
    try {
        const id = req.params.id.trim().toUpperCase();
        const employee = await Employee.findOne({ id }).lean();

        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found." });
        }

        const logs = await AttendanceLog.find({ employeeId: id }).lean();
        const absenceReports = await AbsenceReport.find({ employeeId: id }).lean();

        const startDate = employee.createdAt ? new Date(employee.createdAt) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = new Date();

        const missedDays = [];
        const historyTimeline = [];

        let curr = new Date(startDate);
        curr.setHours(0, 0, 0, 0);

        const workDays = (employee.workDays && employee.workDays.length > 0) ? employee.workDays : [1, 2, 3, 4, 5, 6];

        while (curr <= endDate) {
            const dayOfWeek = curr.getDay();
            const dateStr = getNigerianDateString(curr);

            if (workDays.includes(dayOfWeek)) {
                const logForDay = logs.find(l => getNigerianDateString(l.checkInTimeRaw) === dateStr);
                const absenceForDay = absenceReports.find(a => a.date === dateStr);

                if (logForDay) {
                    historyTimeline.push({
                        date: dateStr,
                        type: 'PRESENT',
                        checkIn: logForDay.checkInTimeFormatted,
                        checkOut: logForDay.checkOutTimeFormatted || (logForDay.status === 'checked_in' ? 'On Shift' : 'Completed'),
                        status: logForDay.status
                    });
                } else if (absenceForDay) {
                    historyTimeline.push({
                        date: dateStr,
                        type: 'ABSENCE_REPORTED',
                        reason: absenceForDay.reason,
                        submittedAt: absenceForDay.submittedAt
                    });
                } else {
                    const isToday = (dateStr === getNigerianDateString(new Date()));
                    if (!isToday) {
                        missedDays.push(dateStr);
                        historyTimeline.push({
                            date: dateStr,
                            type: 'MISSED_DAY'
                        });
                    }
                }
            }
            curr.setDate(curr.getDate() + 1);
        }

        res.json({
            success: true,
            employee,
            totalPresentDays: logs.length,
            totalAbsencesReported: absenceReports.length,
            totalMissedDays: missedDays.length,
            missedDatesList: missedDays,
            timeline: historyTimeline.reverse()
        });

    } catch (err) {
        console.error("Employee history audit failed:", err);
        res.status(500).json({ success: false, message: "History audit database error." });
    }
});

// 2. BROADCAST NOTICE
app.post('/api/admin/notice', async (req, res) => {
    try {
        const noticeText = req.body.notice ? req.body.notice.trim() : null;
        if (noticeText) {
            await Notice.findOneAndUpdate({}, { noticeText }, { upsert: true, new: true });
            return res.json({ success: true, message: "Notice successfully saved to database!" });
        }
        res.status(400).json({ success: false, message: "Notice parameter missing." });
    } catch (err) {
        console.error("Notice update failed:", err);
        res.status(500).json({ success: false, message: "Notice database update failed." });
    }
});

// 3. REGISTER STAFF PROFILE
app.post(['/api/employees', '/api/admin/register'], async (req, res) => {
    try {
        const { id, name, requiredHours, shiftHours, cutoffHour, cutoffMinute, workDays } = req.body;
        
        if (!id || !name || !id.trim() || !name.trim()) {
            return res.status(400).json({ success: false, message: "Missing ID or Name parameters." });
        }
        
        const targetId = id.trim().toUpperCase();
        const hours = parseInt(shiftHours) || parseInt(requiredHours) || 10;
        const parsedWorkDays = Array.isArray(workDays) ? workDays.map(Number) : [1, 2, 3, 4, 5, 6];

        const updatedEmployee = await Employee.findOneAndUpdate(
            { id: targetId },
            {
                id: targetId,
                name: name.trim(),
                role: "Staff Member",
                shiftHours: hours,
                cutoffHour: cutoffHour !== undefined && cutoffHour !== "" ? parseInt(cutoffHour) : 8,
                cutoffMinute: cutoffMinute !== undefined && cutoffMinute !== "" ? parseInt(cutoffMinute) : 0,
                workDays: parsedWorkDays
            },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ 
            success: true, 
            message: `Profile registered for ${updatedEmployee.name} [${targetId}] in MongoDB!` 
        });
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ success: false, message: "Database write error during registration." });
    }
});

// 4. NOTICE GETTER FOR HOMEPAGE
app.get('/api/notice', async (req, res) => {
    try {
        const activeNotice = await getNoticeText();
        res.json({ notice: activeNotice });
    } catch (err) {
        res.json({ notice: "Welcome to DE CHIS STORES Portal!" });
    }
});

// 5. GET COMPACT ACTIVE COUNT
app.get('/api/attendance/active-count', async (req, res) => {
    try {
        const count = await AttendanceLog.countDocuments({ status: 'checked_in' });
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

// 6. LIVE SESSION CHECK FOR USERS
app.get('/api/attendance/status/:id', async (req, res) => {
    try {
        if (!req.params.id) {
            return res.status(400).json({ status: "error", message: "ID parameter missing" });
        }

        const id = req.params.id.trim().toUpperCase();
        const employee = await Employee.findOne({ id });
        
        if (!employee) {
            return res.json({ status: "unregistered" });
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        const currentLog = await AttendanceLog.findOne({ employeeId: id, status: 'checked_in' });

        if (currentLog) {
            const checkInDate = new Date(currentLog.checkInTimeRaw);
            
            if (checkInDate < startOfToday) {
                currentLog.status = 'LEFT';
                currentLog.checkOutTimeRaw = new Date(checkInDate.getFullYear(), checkInDate.getMonth(), checkInDate.getDate(), 23, 59, 59);
                currentLog.checkOutTimeFormatted = "11:59 PM";
                await currentLog.save();

                const todayCompleted = await AttendanceLog.findOne({
                    employeeId: id,
                    checkInTimeRaw: { $gte: startOfToday, $lte: endOfToday }
                });

                if (todayCompleted) {
                    return res.json({ status: "completed" });
                }

                return res.json({ status: "not_checked_in", name: employee.name });
            }

            return res.json({
                status: currentLog.status,
                name: employee.name,
                checkInTime: currentLog.checkInTimeFormatted,
                checkInTimeRaw: currentLog.checkInTimeRaw ? currentLog.checkInTimeRaw.toISOString() : new Date().toISOString(),
                shiftHours: employee.shiftHours || 10
            });
        }

        const completedToday = await AttendanceLog.findOne({
            employeeId: id,
            checkInTimeRaw: { $gte: startOfToday, $lte: endOfToday },
            status: { $in: ['completed', 'LEFT'] }
        });

        if (completedToday) {
            return res.json({ status: "completed" });
        }

        res.json({ status: "not_checked_in", name: employee.name });

    } catch (err) {
        console.error("Status query error:", err);
        res.status(500).json({ status: "error" });
    }
});

// 7. SECURE SIGN IN/OUT PROCESSOR
app.post('/api/attendance', async (req, res) => {
    try {
        const { employeeId, action, lat, lon, deviceId } = req.body;
        
        if (!employeeId || !employeeId.trim()) {
            return res.status(400).json({ success: false, message: "Employee ID is required." });
        }

        const id = employeeId.trim().toUpperCase();

        const employee = await Employee.findOne({ id });
        if (!employee) return res.status(400).json({ success: false, message: "ID unregistered in database." });

        const parsedLat = parseFloat(lat);
        const parsedLon = parseFloat(lon);

        if (isNaN(parsedLat) || isNaN(parsedLon)) {
            return res.status(400).json({ success: false, message: "Access Denied: GPS coordinate missing or invalid." });
        }

        const distance = calculateDistance(parsedLat, parsedLon, STORE_COORDS.lat, STORE_COORDS.lon);
        if (distance > MAX_DISTANCE_METERS) {
            return res.status(403).json({ success: false, message: `Outside store boundaries.` });
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        if (action === 'checkin') {
            const existingToday = await AttendanceLog.findOne({
                employeeId: id,
                checkInTimeRaw: { $gte: startOfToday, $lte: endOfToday }
            });

            if (existingToday) {
                return res.status(400).json({ success: false, message: "You have already checked in today. Please return tomorrow!" });
            }

            if (isPastEmployeeCutoff(employee)) {
                const formattedCutoff = `${String(employee.cutoffHour || 8).padStart(2, '0')}:${String(employee.cutoffMinute || 0).padStart(2, '0')}`;
                return res.status(403).json({ success: false, message: `Check-in window closed at ${formattedCutoff}.` });
            }

            if (!deviceId || !deviceId.trim()) {
                return res.status(400).json({ success: false, message: "Device fingerprint missing." });
            }

            const cleanDeviceId = deviceId.trim();
            const fraudDeviceMatch = await AttendanceLog.findOne({ 
                deviceId: cleanDeviceId, 
                status: 'checked_in', 
                employeeId: { $ne: id } 
            });

            if (fraudDeviceMatch) {
                return res.status(403).json({ success: false, message: "Fraud Protection: Device already active for another staff." });
            }

            const newLog = await AttendanceLog.create({
                employeeId: id,
                status: 'checked_in',
                deviceId: cleanDeviceId,
                checkInTimeRaw: now,
                checkInTimeFormatted: getFormattedNigerianTime(now)
            });

            return res.json({ 
                success: true, 
                message: `Welcome on shift, ${employee.name}.`,
                checkInTimeRaw: newLog.checkInTimeRaw.toISOString()
            });

        } else if (action === 'checkout') {
            const activeLog = await AttendanceLog.findOne({ employeeId: id, status: 'checked_in' });
            if (!activeLog) return res.status(400).json({ success: false, message: "No active session." });
            
            activeLog.status = 'completed';
            activeLog.checkOutTimeRaw = now;
            activeLog.checkOutTimeFormatted = getFormattedNigerianTime(now);
            await activeLog.save();
            return res.json({ success: true, message: "Shift finalized safely!" });
        }

        res.status(400).json({ success: false, message: "System anomaly: Unrecognized action." });
    } catch (err) {
        console.error("Attendance transaction error:", err);
        res.status(500).json({ success: false, message: "Database transaction failed." });
    }
});

// 8. DELETE STAFF MEMBER
app.delete('/api/employees/:id', async (req, res) => {
    try {
        if (!req.params.id) {
            return res.status(400).json({ success: false, message: "ID parameter required." });
        }

        const id = req.params.id.trim().toUpperCase();
        const deleted = await Employee.findOneAndDelete({ id });

        if (deleted) {
            await AttendanceLog.deleteMany({ employeeId: id });
            await AbsenceReport.deleteMany({ employeeId: id });
            return res.json({ success: true, message: "Staff records wiped from database." });
        }
        res.status(404).json({ success: false, message: "ID not found." });
    } catch (err) {
        console.error("Delete employee error:", err);
        res.status(500).json({ success: false, message: "Failed to drop staff record." });
    }
});

// 9. ABSENCE SUBMISSIONS
app.post('/api/absence-report', async (req, res) => {
    try {
        const { employeeId, reason } = req.body;
        
        if (!employeeId || !reason || !employeeId.trim() || !reason.trim()) {
            return res.status(400).json({ success: false, message: "Employee ID and reason are required." });
        }

        const id = employeeId.trim().toUpperCase();
        
        const employee = await Employee.findOne({ id });
        if (!employee) return res.status(400).json({ success: false, message: "ID unregistered." });
        
        const now = new Date();
        await AbsenceReport.create({
            date: getNigerianDateString(now),
            employeeId: id,
            name: employee.name,
            reason: reason.trim(),
            submittedAt: getFormattedNigerianTime(now)
        });
        
        res.json({ success: true, message: "Absence ticket logged in MongoDB!" });
    } catch (err) {
        console.error("Absence logging error:", err);
        res.status(500).json({ success: false, message: "Could not log absence ticket." });
    }
});

// ========================================================
// FREE HOSTING KEEP-ALIVE SYSTEM
// ========================================================
setInterval(() => {
    if (mongoose.connection.readyState === 1) {
        AttendanceLog.estimatedDocumentCount().catch(() => {});
    }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`[DE CHIS STORES PORTAL ENGINE LIVE AND DB ATTACHED ON PORT ${PORT}]`);
});