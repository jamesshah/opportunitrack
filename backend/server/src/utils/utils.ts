import "dotenv/config";
import { createHmac } from "node:crypto";

class Utils {
	/**
	 * Get timestamp from provided days ago. Default to 7 days ago
	 * @param days number of days in past to get timestamp of. Defaults to 7
	 * @returns timestamp UNIX timestamp in seconds from days ago
	 */
	static getTimestampDaysAgo(days: number = 7): number {
		const oneMonthAgo = new Date();
		oneMonthAgo.setDate(oneMonthAgo.getDate() - days);
		return Math.floor(oneMonthAgo.getTime() / 1000);
	}

	static getHmacSignature(data: any) {
		const secret = process.env.NYLAS_WEBHOOK_SECRET;
		if (!secret) {
			throw Error("Nylas webhook secret not found");
		}
		const hmac = createHmac("sha256", secret);
		hmac.update(data);

		return hmac.digest("hex");
	}
}

export default Utils;
