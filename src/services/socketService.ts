// ============================================
// socketService.ts
// NAGA SYSTEM
// React + Socket.IO Client
// ============================================

import { io, Socket } from "socket.io-client";

// ============================================
// API URL
// ============================================

// Replace the IP below with your Node.js server's LAN IP.
// This MUST include the http:// scheme, or both socket.io
// and fetch() calls will silently fail / hit the wrong URL.
//
// Same machine:      http://localhost:5000
// Different machine:  http://192.168.100.24:5000

export const API_URL = "https://naga-ready-backend.onrender.com";

// ============================================
// Create Socket Connection
// ============================================

export const socket: Socket = io(API_URL, {

    transports: ["websocket"],

    autoConnect: true,

    reconnection: true,

    reconnectionAttempts: Infinity,

    reconnectionDelay: 1000,

    timeout: 10000

});

// ============================================
// Connection Events
// ============================================

socket.on("connect", () => {

    console.log("================================");
    console.log("Connected to Node Server");
    console.log("Socket ID:", socket.id);
    console.log("================================");

});

socket.on("disconnect", (reason) => {

    console.log("================================");
    console.log("Disconnected");
    console.log(reason);
    console.log("================================");

});

socket.on("connect_error", (err) => {

    console.log("================================");
    console.log("Connection Error");
    console.log(err.message);
    console.log("================================");

});

socket.on("reconnect", (attempt) => {

    console.log("================================");
    console.log("Reconnected");
    console.log("Attempt:", attempt);
    console.log("================================");

});

socket.on("reconnect_attempt", (attempt) => {

    console.log("Trying to reconnect...");
    console.log("Attempt:", attempt);

});

// ============================================
// Helper Functions
// ============================================

export const connectSocket = () => {

    if (!socket.connected) {

        socket.connect();

    }

};

export const disconnectSocket = () => {

    if (socket.connected) {

        socket.disconnect();

    }

};

export default socket;