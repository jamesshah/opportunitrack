import { NextFunction, Request, Response } from "express";
import { Utils } from "../utils/index.js";
import { RequestWithRawBody } from "../models/RequestWithRawBody.js";

const verifyNylasWebhookSignature = (
	req: RequestWithRawBody,
	res: Response,
	next: NextFunction
) => {
	const signature = req.header("x-nylas-signature");
	if (!signature) {
		console.error("[ERROR] : webhook request without signature");
		return res.sendStatus(401);
	}

	try {
		const expectedSignature = Utils.getHmacSignature(req.rawBody);

		if (!(expectedSignature === signature)) {
			console.error("[ERROR] webhook signatures didn't match");
			return res.sendStatus(401);
		}

		next();
	} catch (error) {
		console.error("[ERROR] verifyWebhookSignature: ", error);
		return res.sendStatus(500);
	}
};

export default verifyNylasWebhookSignature;
