import { Router } from "express";
import { NylasClient, RedisClient, Supabase, Utils } from "../utils/index.js";
import { Message } from "nylas";

const router = Router();
const nylas = NylasClient.getInstance();
/**
 * GET /auth
 * Redirects to Nylas Auth Url
 */
router.get("/auth", (req, res) => {
	const authUrl = nylas.auth.urlForOAuth2(NylasClient.getUrlAuthConfigs());
	res.redirect(authUrl);
});

/**
 * GET /webhook
 * Route to resolve Nylas webhook challenge
 */
router.get("/webhook", (req, res) => {
	if (req.query.challenge) {
		console.log(`Received challenge code! - ${req.query.challenge}`);
		console.log(`Now returning challenge code! - ${req.query.challenge}`);

		// we need to enable the webhook by responding with the challenge parameter
		return res.send(req.query.challenge);
	}
});

/**
 * POST /webhook
 * @description Route to receive Nylas webhook events
 *
 */
router.post("/webhook", async (req, res) => {
	console.log("received webhook request");
	try {
		const webhookMessage = req.body;
		// console.log(webhookMessage);

		console.log(`Event : ${webhookMessage.type}  received from Nylas`);

		// const data = message["data"];

		// if (webhookMessage.type == "grant.created") {
		// 	console.log("new grant created");

		// 	const object = webhookMessage.data.object;

		// 	console.log(object);

		// 	const backgroundJobId = await Supabase.getInstance()
		// 		?.from("BackgroundProcess")
		// 		.insert({
		// 			grant_id: object?.grant_id,
		// 			status: "RUNNING",
		// 		})
		// 		.select("id");

		// 	// Add the background job and start pushing messages into the queue
		// 	res.sendStatus(200);

		// 	setImmediate(async () => {
		// 		// console.log("Started email processing...");
		// 		const data = (await getEmails(object?.grant_id)).map(
		// 			(email) => ({
		// 				body: email.body,
		// 				subject: email.subject,
		// 				from: email.from,
		// 				date: email.date,
		// 			})
		// 		);

		// 		const response = await RedisClient.lPush(
		// 			"process-email-queue",
		// 			JSON.stringify({
		// 				data: [data[0]],
		// 				grantId: object?.grant_id,
		// 				backgroundJobId,
		// 			}) // TODO : Pass data instead
		// 		);
		// 		console.log(response);
		// 	});
		// } else
		if (webhookMessage.type == "message.created") {
			console.log("inside message.created type");
			const message = webhookMessage.data.object;
			console.log(message.grant_id);

			const jsonData = JSON.stringify({
				grantId: message.grant_id,
				data: {
					body: message.body,
					subject: message.subject,
					from: message.from,
					date: message.date,
				},
			});

			console.log("jsonData:", jsonData);
			try {
				const response = await RedisClient.lPush(
					"process-email-queue",
					jsonData
				);
				console.log(response);

				return res.sendStatus(200);
			} catch (err) {
				console.error(err);
				return res.sendStatus(500);
			}
		} else {
			return res.sendStatus(400);
		}
	} catch (error) {
		console.log(error);
		return res.sendStatus(500);
	}
});

// router.post("/start-processing", async (req, res) => {
// 	console.log("[INFO] start-processing started");

// 	const grant_id = req.query.grant_id;

// 	if (!grant_id) {
// 		return res.status(400).json({ error: "grant_id is required" });
// 	} else {
// 		const supabase = Supabase.getInstance();
// 		if (supabase != undefined) {
// 			const { data, error } = await supabase
// 				.from("BackgroundProcess")
// 				.insert({
// 					grant_id: grant_id as string,
// 					status: "RUNNING",
// 				})
// 				.select("id, grant_id, status")
// 				.single();

// 			console.log(data);

// 			if (error) {
// 				console.error(error);
// 				return res.sendStatus(500);
// 			}

// 			const backgroundJobId = data.id;
// 			console.log(
// 				`Background process started with id: ${backgroundJobId} for grant_id: ${grant_id}`
// 			);

// 			// Add the background job and start pushing messages into the queue
// 			res.json(data).end();

// 			setImmediate(async () => {
// 				// console.log("Started email processing...");
// 				const data = (await getEmails(grant_id as string)).map(
// 					(email) => ({
// 						body: email.body,
// 						subject: email.subject,
// 						from: email.from,
// 						date: email.date,
// 					})
// 				);

// 				const response = await RedisClient.lPush(
// 					"process-email-queue",
// 					JSON.stringify({
// 						data: data,
// 						grantId: grant_id as string,
// 						backgroundJobId,
// 					}) // TODO : Pass data instead
// 				);
// 				console.log(response);
// 			});
// 		}
// 	}
// });

// router.get("/recent-emails", async (req, res) => {
// 	try {
// 		// TODO: Change this to req params
// 		const identifier = process.env.USER_GRANT_ID!;
// 		const allRecords = await getEmails(identifier);
// 		return res.json(allRecords);
// 	} catch (error) {
// 		console.error("Error fetching emails:", error);
// 		return res
// 			.status(500)
// 			.json({ error: "Something went wrong. Please try again later!" });
// 	}
// });

export { router };
