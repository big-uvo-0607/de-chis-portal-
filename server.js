const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// ========================================================
// FOLDER PATH CORRECTION (Matches public/ layout)
// ========================================================
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).send("<h1>DE CHIS STORES Portal</h1><p>index.html not found inside the public folder.</p>");
        }
    });
});

app.get('/index.html', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).send("<h1>Error</h1><p>index.html not found inside public folder.</p>");
        }
    });
});

app.get('/admin.html', (req, res) => {
    let filePath = path.join(__dirname, 'admin.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            filePath = path.join(__dirname, 'public', 'admin.html');
            res.sendFile(filePath, (err2) => {
                if (err2) {
                    res.status(404).send("<h1>Error</h1><p>admin.html not found in root or public folder.</p>");
                }
            });
        }
    });
});

// Serve static assets from both public and root directory levels safely
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// ========================================================
// 1. SYSTEM CONFIGURATION (SECURITY PERIMETERS)
// ========================================================
const STORE_COORDS = { lat: 9.852923, lon: 8.852990 }; 
const MAX_DISTANCE_METERS = 100; 

// ========================================================
// 2. SIMULATED DATABASE (EMPLOYEES WITH DYNAMIC SHIFTS)
// ========================================================
let employees = {
    "EMP001": { id: "EMP001", name: "John Doe", role: "Floor Manager", shiftHours: 9, cutoffHour: 8, cutoffMinute: 5 },
    "EMP002": { id: "EMP002", name: "Jane Smith", role: "Cashier", shiftHours: 8, cutoffHour: 15, cutoffMinute: 0 },
    "EMP003": { id: "EMP003", name: "Blessing Okafor", role: "Inventory Supervisor", shiftHours: 10, cutoffHour: 8, cutoffMinute: 5 }
};

let attendanceLog = {}; 
let systemNotice = "Welcome to DE CHIS STORES Portal! Please check in according to your designated shift schedule.";

// ========================================================
// 3. SECURE VALIDATION ENGINES
// ========================================================
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
// 4. API ROUTERS / ENDPOINTS
// ========================================================

// DUAL-ROUTE HANDLER (Fixes the admin "cannot connect" dashboard problem)
app.post(['/api/employees', '/api/admin/register'], (req, res) => {
    const { id, name, role, requiredHours, shiftHours, cutoffHour, cutoffMinute } = req.body;
    
    if (!id || !name) {
        return res.status(400).json({ success: false, message: "Missing tracking keys. ID and Name are required." });
    }
    
    const targetId = id.toUpperCase();
    
    employees[targetId] = {
        id: targetId,
        name: name,
        role: role || "Staff Member",
        shiftHours: parseInt(shiftHours) || parseInt(requiredHours) || 8,
        cutoffHour: cutoffHour !== undefined ? parseInt(cutoffHour) : 8,
        cutoffMinute: cutoffMinute !== undefined ? parseInt(cutoffMinute) : 0
    };

    res.json({ success: true, message: `Dynamic profile created for ${name} successfully!` });
});

app.get('/api/notice', (req, res) => {
    res.json({ notice: systemNotice });
});

app.get('/api/attendance/active-count', (req, res) => {
    const count = Object.values(attendanceLog).filter(log => log.status === 'checked_in').length;
    res.json({ count });
});

app.get('/api/attendance/status/:id', (req, res) => {
    const id = req.params.id.toUpperCase();
    
    if (!employees[id]) {
        return res.json({ status: "unregistered" });
    }

    const currentLog = attendanceLog[id];
    if (!currentLog) {
        return res.json({ status: "not_checked_in" });
    }

    if (currentLog.status === 'checked_in' && isPastEmployeeCutoff(employees[id])) {
        attendanceLog[id].status = 'completed';
        return res.json({ status: "completed" });
    }

    res.json({
        status: currentLog.status,
        name: employees[id].name,
        checkInTime: currentLog.checkInTimeFormatted,
        shiftHours: employees[id].shiftHours
    });
});

app.post('/api/attendance', (req, res) => {
    const { employeeId, action, lat, lon, deviceId } = req.body;
    const id = employeeId.toUpperCase();

    if (!employees[id]) {
        return res.status(400).json({ success: false, message: "Profile identification failed. ID unregistered." });
    }

    const currentWorker = employees[id];

    if (!lat || !lon) {
        return res.status(400).json({ success: false, message: "Access Denied: Device GPS signal missing." });
    }
    const distance = calculateDistance(lat, lon, STORE_COORDS.lat, STORE_COORDS.lon);
    if (distance > MAX_DISTANCE_METERS) {
        return res.status(403).json({ 
            success: false, 
            message: `Verification Failed: You are outside store boundaries (${Math.round(distance)}m away).` 
        });
    }

    if (action === 'checkin' && isPastEmployeeCutoff(currentWorker)) {
        const formattedCutoff = `${String(currentWorker.cutoffHour).padStart(2, '0')}:${String(currentWorker.cutoffMinute).padStart(2, '0')}`;
        return res.status(403).json({ 
            success: false, 
            message: `Access Refused: You are late! Your shift check-in window closed at ${formattedCutoff}.` 
        });
    }

    if (action === 'checkin') {
        if (!deviceId) {
            return res.status(400).json({ success: false, message: "Security Error: Device fingerprint missing." });
        }

        const fraudDeviceMatch = Object.keys(attendanceLog).find(
            empId => attendanceLog[empId].deviceId === deviceId && empId !== id
        );

        if (fraudDeviceMatch) {
            return res.status(403).json({ 
                success: false, 
                message: "Fraud Protection: This device has already been used to check in another employee today." 
            });
        }
    }

    const now = new Date();

    if (action === 'checkin') {
        attendanceLog[id] = {
            status: 'checked_in',
            deviceId: deviceId, 
            checkInTimeRaw: now.toISOString(),
            checkInTimeFormatted: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        return res.json({ success: true, message: `Welcome on shift, ${currentWorker.name}. Session secured.` });
        
    } else if (action === 'checkout') {
        if (!attendanceLog[id] || attendanceLog[id].status !== 'checked_in') {
            return res.status(400).json({ success: false, message: "Error: No active open session found for this profile." });
        }
        
        attendanceLog[id].status = 'completed';
        attendanceLog[id].checkOutTimeRaw = now.toISOString();
        return res.json({ success: true, message: "Shift finalized. Have a safe trip home!" });
    }

    res.status(400).json({ success: false, message: "System operational anomaly." });
});

app.delete('/api/employees/:id', (req, res) => {
    const id = req.params.id.toUpperCase();
    if (employees[id]) {
        delete employees[id];
        delete attendanceLog[id]; 
        return res.json({ success: true, message: "Profile record completely dropped." });
    }
    res.status(404).json({ success: false, message: "Target ID not found." });
});

app.post('/api/absence-report', (req, res) => {
    const { employeeId, reason } = req.body;
    const id = employeeId.toUpperCase();
    if (!employees[id]) return res.status(400).json({ success: false, message: "ID unregistered." });
    
    console.log(`[ABSENCE INCIDENT] Employee: ${id} - Reason: ${reason}`);
    res.json({ success: true, message: "Absence ticket filed directly into management console." });
});

app.listen(PORT, () => {
    console.log(`[DE CHIS STORES PORTAL ACTIVE WITH CUSTOM SHIFT LOCKS ON PORT ${PORT}]`);
});