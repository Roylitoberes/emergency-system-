import express from "express";
import cors from "cors";

import { initializeApp, cert } from "firebase-admin/app";
import {
    getFirestore,
    FieldValue
} from "firebase-admin/firestore";

import serviceAccount from "./serviceAccountKey.json";

// ==================================
// EXPRESS SERVER
// ==================================

const app = express();

app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://localhost:5173', 
        'http://192.168.100.14:3000',
        'http://192.168.100.14:5173',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================================
// REQUEST LOGGING MIDDLEWARE
// ==================================

app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path} - ${req.ip}`);
    next();
});

// ==================================
// FIREBASE ADMIN SDK
// ==================================

try {
    initializeApp({
        credential: cert(serviceAccount as any)
    });
    console.log("✅ Firebase Admin initialized successfully");
} catch (error) {
    console.error("❌ Firebase Admin initialization failed:", error);
    process.exit(1);
}

const db = getFirestore();

// ==================================
// HEALTH CHECK ENDPOINT
// ==================================

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==================================
// RECEIVE LORA DATA FROM ESP32 GATEWAY
// ==================================

app.post("/lora", async (req, res) => {
    const startTime = Date.now();
    
    try {
        const data = req.body;

        console.log("=====================");
        console.log("📡 LoRa Data Received");
        console.log("📦 Body:", JSON.stringify(data, null, 2));
        console.log("=====================");

        // Validate required fields
        if (!data.deviceId && !data.device_id) {
            console.warn("⚠️ Missing deviceId in request");
            return res.status(400).json({
                success: false,
                error: "Missing deviceId field"
            });
        }

        // Extract data with fallbacks
        const deviceId = data.deviceId || data.device_id || "UNKNOWN";
        const incidentType = data.incidentType || data.incident_type || "UNKNOWN";
        const incidentCode = data.incidentCode || data.incident_code || 0;
        
        // Handle latitude and longitude
        let latitude = data.latitude || data.lat || 0;
        let longitude = data.longitude || data.lon || 0;
        
        if (typeof latitude === 'string') {
            latitude = parseFloat(latitude);
        }
        if (typeof longitude === 'string') {
            longitude = parseFloat(longitude);
        }
        
        // Validate coordinates
        if (isNaN(latitude) || isNaN(longitude)) {
            console.warn("⚠️ Invalid coordinates received:", { latitude, longitude });
            latitude = 0;
            longitude = 0;
        }
        
        const gpsLocked = data.gpsLocked || data.gps_locked || 0;
        const rssi = data.rssi || 0;
        const snr = data.snr || 0;
        
        // Create message with incident type
        const typeEmoji: { [key: string]: string } = {
            'FIRE': '🔥',
            'MEDICAL': '🏥',
            'FLOOD': '🌊',
            'EARTHQUAKE': '🌋',
            'TYPHOON': '🌀',
            'ACCIDENT': '🚗'
        };
        const emoji = typeEmoji[incidentType.toUpperCase()] || '🚨';
        
        const message = data.message || `${emoji} LoRa ${incidentType} alert from ${deviceId}`;

        // Create alert data for Firestore
        const alertData = {
            source: "LoRa",
            deviceId: deviceId,
            message: message,
            type: "danger",
            incidentCode: incidentCode,
            incidentType: incidentType,
            latitude: latitude,
            longitude: longitude,
            gpsLocked: gpsLocked === 1 || gpsLocked === true,
            rssi: rssi,
            snr: snr,
            read: false,
            timestamp: FieldValue.serverTimestamp(),
            receivedAt: new Date().toISOString(),
        };

        // Save to Firestore
        const alertRef = await db
            .collection("lora_alerts")
            .add(alertData);

        const responseTime = Date.now() - startTime;
        console.log(`✅ Saved to Firestore ID: ${alertRef.id} (${responseTime}ms)`);

        res.status(200).json({
            success: true,
            message: "LoRa alert saved",
            id: alertRef.id,
            deviceId: deviceId,
            incidentType: incidentType,
            responseTime: responseTime
        });
    }
    catch (error) {
        const responseTime = Date.now() - startTime;
        console.error("❌ Error processing request:", error);
        console.error("❌ Error details:", error instanceof Error ? error.stack : error);
        
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Internal server error",
            responseTime: responseTime
        });
    }
});

// ==================================
// GET ALL ALERTS
// ==================================

app.get("/alerts", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const maxLimit = 100;
        const finalLimit = Math.min(limit, maxLimit);
        
        const snapshot = await db
            .collection("lora_alerts")
            .orderBy("timestamp", "desc")
            .limit(finalLimit)
            .get();

        const alerts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`📊 Retrieved ${alerts.length} alerts`);

        res.status(200).json({
            success: true,
            count: alerts.length,
            total: snapshot.size,
            alerts: alerts
        });
    } catch (error) {
        console.error("❌ Error fetching alerts:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

// ==================================
// GET UNREAD ALERTS COUNT
// ==================================

app.get("/alerts/unread/count", async (req, res) => {
    try {
        const snapshot = await db
            .collection("lora_alerts")
            .where("read", "==", false)
            .get();

        res.status(200).json({
            success: true,
            unreadCount: snapshot.size
        });
    } catch (error) {
        console.error("❌ Error fetching unread count:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

// ==================================
// MARK ALERT AS READ
// ==================================

app.put("/alerts/:id/read", async (req, res) => {
    try {
        const alertId = req.params.id;
        
        await db
            .collection("lora_alerts")
            .doc(alertId)
            .update({
                read: true,
                readAt: new Date().toISOString()
            });

        res.status(200).json({
            success: true,
            message: "Alert marked as read",
            id: alertId
        });
    } catch (error) {
        console.error("❌ Error marking alert as read:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

// ==================================
// TEST ENDPOINT - For ESP32
// ==================================

app.get("/test", (req, res) => {
    console.log("🧪 Test endpoint called from:", req.ip);
    
    res.status(200).json({
        success: true,
        message: "Server is running!",
        timestamp: new Date().toISOString(),
        serverInfo: {
            nodeVersion: process.version,
            platform: process.platform,
            uptime: Math.floor(process.uptime())
        }
    });
});

// ==================================
// ROOT ENDPOINT
// ==================================

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>🚀 LoRa Gateway Server</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #1a1a2e; color: white; }
                .container { max-width: 800px; margin: 0 auto; }
                h1 { color: #EB1616; }
                .status { background: #28a745; padding: 10px; border-radius: 5px; display: inline-block; }
                ul { list-style: none; padding: 0; }
                li { background: #2a2a4e; padding: 10px; margin: 5px 0; border-radius: 5px; }
                li code { color: #EB1616; background: #1a1a2e; padding: 2px 6px; border-radius: 3px; }
                .footer { margin-top: 40px; color: #6C7293; border-top: 1px solid #333; padding-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 LoRa Gateway Server</h1>
                <div class="status">✅ Server is running</div>
                <p>Time: ${new Date().toLocaleString()}</p>
                <h2>📋 Available Endpoints:</h2>
                <ul>
                    <li>📡 <code>POST /lora</code> - Receive LoRa alerts</li>
                    <li>📊 <code>GET /alerts</code> - View all alerts</li>
                    <li>📊 <code>GET /alerts/unread/count</code> - Get unread count</li>
                    <li>📝 <code>PUT /alerts/:id/read</code> - Mark alert as read</li>
                    <li>🧪 <code>GET /test</code> - Test connection</li>
                    <li>❤️ <code>GET /health</code> - Health check</li>
                </ul>
                <div class="footer">
                    <p>Server Info: Node ${process.version} | ${process.platform}</p>
                    <p>Uptime: ${Math.floor(process.uptime())} seconds</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// ==================================
// 404 HANDLER
// ==================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: `Endpoint ${req.path} not found`
    });
});

// ==================================
// ERROR HANDLER
// ==================================

app.use((err: any, req: any, res: any, next: any) => {
    console.error("❌ Unhandled error:", err);
    res.status(500).json({
        success: false,
        error: err.message || "Internal server error"
    });
});

// ==================================
// START SERVER
// ==================================

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
    console.log("================================");
    console.log("🚀 LoRa Server Running");
    console.log(`📡 Host: ${HOST}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log(`🌐 URL: http://192.168.100.14:${PORT}`);
    console.log("================================");
    console.log("📋 Available endpoints:");
    console.log(`   GET  http://192.168.100.14:${PORT}/`);
    console.log(`   POST http://192.168.100.14:${PORT}/lora`);
    console.log(`   GET  http://192.168.100.14:${PORT}/alerts`);
    console.log(`   GET  http://192.168.100.14:${PORT}/alerts/unread/count`);
    console.log(`   PUT  http://192.168.100.14:${PORT}/alerts/:id/read`);
    console.log(`   GET  http://192.168.100.14:${PORT}/test`);
    console.log(`   GET  http://192.168.100.14:${PORT}/health`);
    console.log("================================");
    console.log("⏳ Waiting for ESP32 Gateway...");
    console.log("================================");
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

export default app;