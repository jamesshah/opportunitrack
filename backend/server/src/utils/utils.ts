import "dotenv/config";

class Utils {
	// private static apnProvider = new apn.Provider({
	// 	token: {
	// 		key: "/Users/jamesshah/Downloads/AuthKey_4PVMR9XVA7.p8",
	// 		keyId: "4PVMR9XVA7",
	// 		teamId: "XH448HPM8W",
	// 	},
	// 	production: false,
	// });

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

	// static async sendNotification(
	// 	title?: string,
	// 	subtitle?: string,
	// 	body?: string,
	// 	badge?: number
	// ) {
	// 	try {
	// 		const notification = new apn.Notification({
	// 			alert: {
	// 				title: title,
	// 				subtitle: subtitle,
	// 				body: body,
	// 			},
	// 			badge: badge,
	// 			topic: "tech.jamesshah.OpportuniTrack",
	// 		});

	// 		const { sent, failed } = await Utils.apnProvider.send(
	// 			notification,
	// 			[process.env.iphone_device_token!]
	// 		);

	// 		if (failed.length > 0) {
	// 			console.error("Failed to send notification:", failed);
	// 		}

	// 		console.log("Successfully sent notification!", sent);
	// 	} catch (e) {
	// 		console.log(`Something went wrong: ${e}`);
	// 	}
	// }
}

export default Utils;
