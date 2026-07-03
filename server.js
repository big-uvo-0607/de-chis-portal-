const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ⚙️ SYSTEM CONFIGURATIONS
// ==========================================
const CUTOFF_TIME = "21:00";   
const REQUIRED_HOURS = 10;     
const MAX_DISTANCE_KM = 0.5;   
const STORE_LAT = 9.852912;     
const STORE_LON = 8.853000;     

// ==========================================
// 📁 PERMANENT FILE PATHS
// ==========================================
const ROSTER_FILE = path.join(__dirname, 'roster.json');
const LOGS_FILE = path.join(__dirname, 'logs.json');
const REPORTS_FILE = path.join(__dirname, 'reports.json');

// Helper function to safely load saved data from files
function readDataFile(filePath, defaultData) {
    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(fileContent);
        }
    } catch (error) {
        console.log(`Error reading ${filePath}, starting fresh.`);
    }
    return defaultData;
}

// Helper function to automatically write updates to the hard drive
function saveDataFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error(`Error saving to ${filePath}:`, err);
    }
}

// ==========================================
// 🗄️ PERSISTENT DATABASES (Loads existing files on start!)
// ==========================================
let employees = readDataFile(ROSTER_FILE, [
    { id: "EMP001", name: "John Doe" },
    { id: "EMP002", name: "Blessing Okafor" },
    { id: "EMP003", name: "Amara Musa" }
]);

let attendanceLogs = readDataFile(LOGS_FILE, []);
let absenceReports = readDataFile(REPORTS_FILE, []);

// Save initial setup structures permanently if they don't exist yet
if (!fs.existsSync(ROSTER_FILE)) saveDataFile(ROSTER_FILE, employees);
if (!fs.existsSync(LOGS_FILE)) saveDataFile(LOGS_FILE, attendanceLogs);
if (!fs.existsSync(REPORTS_FILE)) saveDataFile(REPORTS_FILE, absenceReports);

// ==========================================
// 🧮 GEOLOCATION CALCULATION HELPER
// ==========================================
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
// 📡 ROUTING & API ENDPOINTS
// ==========================================

// 1. Fetch Employee Live Status for Dynamic UI Buttons
app.get('/api/attendance/status/:empId', (req, res) => {
    const { empId } = req.params;
    const today = getTodayDate();
    
    const employee = employees.find(e => e.id === empId);
    if (!employee) return res.json({ status: "unregistered" });

    const log = attendanceLogs.find(l => l.id === empId && l.date === today);
    if (!log) return res.json({ status: "not_checked_in", name: employee.name });
    if (log && !log.checkOut) return res.json({ status: "checked_in", name: employee.name, checkInTime: log.checkIn });
    return res.json({ status: "completed", name: employee.name });
});

// 2. Process Employee Clocking Actions
app.post('/api/attendance', (req, res) => {
    const { employeeId, action, lat, lon } = req.body;
    
    console.log(`=== LIVE GPS ATTEMPT === Lat: ${lat}, Lon: ${lon}`);

    const today = getTodayDate();
    const now = new Date();
    const currentTimeString = now.toTimeString().split(' ')[0].substring(0, 5);

    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return res.status(400).json({ success: false, message: "ID not registered." });

    if (!lat || !lon) return res.status(400).json({ success: false, message: "Location tracking must be enabled." });

    const distance = getDistance(STORE_LAT, STORE_LON, lat, lon);
    if (distance > MAX_DISTANCE_KM) return res.status(400).json({ success: false, message: "You must be at the supermarket premises." });

    let logIndex = attendanceLogs.findIndex(l => l.id === employeeId && l.date === today);

    if (action === 'checkin') {
        if (logIndex !== -1) return res.status(400).json({ success: false, message: "Already checked in today." });
        if (currentTimeString > CUTOFF_TIME) return res.status(400).json({ success: false, message: `Late! Cutoff was ${CUTOFF_TIME}.` });

        attendanceLogs.push({
            id: employeeId,
            name: employee.name,
            date: today,
            checkIn: now.toLocaleTimeString(),
            checkInRaw: now.getTime(), 
            checkOut: null,
            hoursWorked: null,
            flagged: false
        });

        saveDataFile(LOGS_FILE, attendanceLogs);
        return res.json({ success: true, message: `Welcome, ${employee.name}!` });

    } else if (action === 'checkout') {
        if (logIndex === -1) return res.status(400).json({ success: false, message: "Must check in first." });
        if (attendanceLogs[logIndex].checkOut) return res.status(400).json({ success: false, message: "Already checked out." });

        const log = attendanceLogs[logIndex];
        const checkOutRaw = now.getTime();
        const millisecondsWorked = checkOutRaw - log.checkInRaw;
        const hoursWorked = (millisecondsWorked / (1000 * 60 * 60)).toFixed(2); 

        log.checkOut = now.toLocaleTimeString();
        log.hoursWorked = `${hoursWorked} hrs`;
        
        if (parseFloat(hoursWorked) < REQUIRED_HOURS) {
            log.flagged = true;
            saveDataFile(LOGS_FILE, attendanceLogs);
            return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed, but flagged for leaving early (${hoursWorked}/${REQUIRED_HOURS} hours).` });
        }

        saveDataFile(LOGS_FILE, attendanceLogs);
        return res.json({ success: true, message: `Goodbye, ${employee.name}! Shift completed (${hoursWorked} hours).` });
    }
});

// 3. File Absence Report
app.post('/api/absence-report', (req, res) => {
    const { employeeId, reason } = req.body;
    const today = getTodayDate();
    
    const actualEmployee = employees.find(e => e.id === employeeId);
    if (!actualEmployee) return res.status(400).json({ success: false, message: "Invalid Employee ID." });
    if (!reason.trim()) return res.status(400).json({ success: false, message: "Please state a valid reason." });

    absenceReports.push({
        id: employeeId,
        name: actualEmployee.name,
        date: today,
        reason: reason,
        submittedAt: new Date().toLocaleTimeString()
    });

    saveDataFile(REPORTS_FILE, absenceReports);
    res.json({ success: true, message: "Absence report forwarded to Admin successfully." });
});

// 4. Fetch Master Matrix Logs for Admin Dashboard Panels
app.get('/api/admin/data', (req, res) => {
    res.json({
        logs: attendanceLogs,
        employeeList: employees,
        absenceReports: absenceReports
    });
});

// 5. Register New Employee Record via Admin Panel
app.post('/api/admin/register', (req, res) => {
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ success: false, message: "All fields are required." });
    if (employees.some(e => e.id === id)) return res.status(400).json({ success: false, message: "ID exists." });
    
    employees.push({ id, name });
    
    saveDataFile(ROSTER_FILE, employees);
    res.json({ success: true, message: "Employee registered successfully." });
});

app.listen(PORT, () => console.log(`Server running smoothly on http://localhost:${PORT}`));