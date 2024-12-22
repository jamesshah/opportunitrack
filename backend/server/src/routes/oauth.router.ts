import { Router } from "express";
import { NylasClient, Supabase } from "../utils/index.js";

const router = Router();
const nylas = NylasClient.getInstance();
const supabase = Supabase.getInstance();
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

		res.redirect(
			`tech.jamesshah.OpportuniTrack://nylas-callback?grant_id=${grantId}`
		);
	} catch (error) {
		console.error("[ERROR] /callback/ios", error);
		res.status(500).send("Failed to exchange authorization code for token");
	}
});

/**
 * DELETE /user
 * Delete user from supabase and delete grant from Nylas
 */
router.delete("/user", async (req, res) => {
	const grantId = req.query.grant_id;
	const userId = req.query.user_id;

	if (!userId || !(typeof userId == "string")) {
		return res.status(400).send({ error: "valid user_id is required" });
	}

	try {
		const response = await supabase?.auth.admin.deleteUser(userId);
		if (response?.error) {
			console.error("Error while deleting supabase user", response.error);
			return res.sendStatus(500);
		}

		if (grantId && typeof grantId == "string") {
			await nylas.grants.destroy({ grantId: grantId });
		}

		return res.sendStatus(204);
	} catch (err) {
		console.error("Error while deleting user", err);
		return res.sendStatus(500);
	}
});

export { router };
