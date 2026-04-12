import express from "express";
import recommendationsRouter from "./recommendations.route";

import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve the frontend UI from the 'public' folder
app.use(express.static(path.join(__dirname, "public")));

// Mount the recommendations route
app.use("/api", recommendationsRouter);

// Start the server
app.listen(PORT, () => {
    console.log(`Airsona Engine API is running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser to view the frontend!`);
});
