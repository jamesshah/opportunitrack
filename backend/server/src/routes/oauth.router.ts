import { Router } from "express";
import { NylasClient } from "../utils/index.js";

const router = Router();
const nylas = NylasClient.getInstance();

/**
 * Exchange auth code for access token
 */
router.get("/callback/web", async (req, res) => {
	console.log("Received callback from Nylas");
	const code = req.query.code as string;

	if (!code) {
		res.status(400).send("No authorization code returned from Nylas");
		return;
	}

	const codeExchangePayload = NylasClient.getCodeExchangePayload(code);

	try {
		const response = await nylas.auth.exchangeCodeForToken(
			codeExchangePayload
		);
		const { grantId } = response;

		// NB: This stores in RAM
		// In a real app you would store this in a database, associated with a user
		process.env.NYLAS_GRANT_ID = grantId;

		res.json({
			message:
				"OAuth2 flow completed successfully for grant ID: " + grantId,
		});
	} catch (error) {
		console.error("[ERROR] /callback/ios", error);
		res.status(500).send("Failed to exchange authorization code for token");
	}
});

// TODO: Remove
// router.get("/ios/deeplink", (req, res) => {
// 	console.log("GET /ios/deeplink");

// 	res.redirect(`job-application-tracker://auth-successful?grant_id=123`);
// });

router.get("/callback/ios", async (req, res) => {
	console.log("Received callback from Nylas for ios");
	const code = req.query.code as string;

	if (!code) {
		res.status(400).send("No authorization code returned from Nylas");
		return;
	}

	const codeExchangePayload = NylasClient.getCodeExchangePayload(code);

	try {
		const response = await nylas.auth.exchangeCodeForToken(
			codeExchangePayload
		);
		const { grantId } = response;

		// NB: This stores in RAM
		// In a real app you would store this in a database, associated with a user
		process.env.NYLAS_GRANT_ID = grantId;

		res.redirect(
			`tech.jamesshah.OpportuniTrack://nylas-callback?grant_id=${grantId}`
		);
	} catch (error) {
		console.error("[ERROR] /callback/ios", error);
		res.status(500).send("Failed to exchange authorization code for token");
	}
});

export { router };
