import { Router } from "express";
import { NylasClient, RedisClient } from "../utils/index.js";
import { nylasMiddleware } from "../middlewares/index.js";

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
router.post("/webhook", nylasMiddleware, async (req, res) => {
	try {
		const webhookMessage = req.body;
		console.log(`Event : ${webhookMessage.type}  received from Nylas`);
		if (webhookMessage.type == "message.created") {
			const message = webhookMessage.data.object;

			const jsonData = JSON.stringify({
				grantId: message.grant_id,
				data: {
					body: message.body,
					subject: message.subject,
					from: message.from,
					date: message.date,
				},
			});

			try {
				const response = await RedisClient.lPush(
					"process-email-queue",
					jsonData
				);

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
export { router };
