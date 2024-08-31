import bodyParser from "body-parser";
import "dotenv/config";
import express from "express";
import { NylasRouter, OAuthRouter } from "./routes/index.js";
import { JobApplicationMessage } from "./models/JobApplicationMessage.js";

const PORT = process.env.PORT || 3000;
const app = express();

app.use(bodyParser.json());

app.get("/health", (req, res) => {
	res.sendStatus(200);
});

// Routes
app.use("/nylas", NylasRouter);
app.use("/oauth", OAuthRouter);

async function startServer() {
	try {
		// const redisClient = RedisClient.

		app.listen(PORT, () => {
			console.log(`Server is running on PORT ${PORT}`);
		});

		// Utils.sendNotification();
	} catch (error) {
		console.error("Error while connecting to redis. Exiting...");
		process.exit(1);
	}
}

startServer();
