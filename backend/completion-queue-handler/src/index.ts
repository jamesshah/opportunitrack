import "dotenv/config";
import { createClient } from "redis";
import apn from "apn";
import SupabaseHelper from "./supabase.js";
import {
	JobApplicationCategory,
	JobApplicationMessage,
	NotificationPayload,
} from "./types.js";

const apnProvider = new apn.Provider({
	token: {
		key: process.env.APN_KEY!,
		keyId: process.env.APN_KEY_ID!,
		teamId: process.env.APN_TEAM_ID!,
	},
	production: false,
});

async function start() {
	try {
		const client = createClient({
			socket: {
				host: process.env.REDIS_HOST || "redis",
				port: 6379,
			},
		});
		const supabase = new SupabaseHelper();

		await client.connect();
		console.log("Redis connected!");

		while (true) {
			try {
				const message = await client.brPop("completion-queue", 0);
				if (message) {
					console.log("Received a message on completion-queue");
					const data: JobApplicationMessage = JSON.parse(
						message.element
					);

					console.debug(data);

					if (data) {
						// Get user from grant_id
						const user = await supabase.getUserFromGrantId(
							data.grant_id
						);

						if (user) {
							console.debug("user found");

							supabase.savePredictionLog(data);

							// Store job application in DB
							const job_application =
								await supabase.saveJobApplication(
									data,
									user.user_id!
								);

							// if (data.background_job_id) {
							// 	// Update background process status in DB
							// 	await supabase.updateBackgroundProcessStatus(
							// 		data.background_job_id
							// 	);
							// }

							if (user.device_token) {
								const payload = getNotificationPayload(
									data,
									job_application.id
								);

								// Send notification to user
								sendNotification(payload, user.device_token);
							}
						}
					}
				}
			} catch (error) {
				console.error(error);
			}
		}
	} catch (error) {
		console.error(error);
		console.error("Exiting...");
		process.exit(1);
	}
}

function getNotificationPayload(
	data: JobApplicationMessage,
	job_application_id: number,
	count?: number
): NotificationPayload {
	let res: NotificationPayload;
	// if (data.background_job_id) {
	// 	res = {
	// 		title: "Job Applications Updated!",
	// 		subtitle: "",
	// 		body: count
	// 			? `All done! We've identified ${count} jobs from last ${process
	// 					.env.BACKGROUND_PROCESSING_DAYS!} days`
	// 			: "All done! Your job application tracker is up-to-date with the latest information.",
	// 		badge: data.job_applications.length,
	// 	};

	// 	return res;
	// } else {
	switch (data.job_application.category) {
		case JobApplicationCategory.APPLIED:
			res = {
				title: "New Job Application Added: Applied",
				subtitle: "",
				body: "You’ve just applied to a new position. Keep track of your progress in the app!🚀",
				job_application_id,
			};
			break;

		case JobApplicationCategory.INVITED_FOR_INTERVIEW:
			res = {
				title: "You're On the Radar!",
				subtitle: "",
				body: "Exciting news! An interview invite just arrived🤞🏻",
				job_application_id,
			};
			break;

		case JobApplicationCategory.OFFERED:
			res = {
				title: "Offer Received: Congratulations!🎉",
				subtitle: "",
				body: "Great news! You’ve received a job offer. Open the app to see the details.",
				job_application_id,
			};
			break;

		case JobApplicationCategory.REJECTED:
			res = {
				title: "Application Update: Rejected",
				subtitle: "",
				body: "A recent application didn't make it through. But don't give up, new opportunities await!",
				job_application_id,
			};
			break;

		default:
			res = {
				title: "Application Status Updated",
				subtitle: "",
				body: "Your job application status has been updated. Check the app for more details..",
				job_application_id,
			};
			break;
	}
	return res;
}

async function sendNotification(
	payload: NotificationPayload,
	device_token: string
) {
	try {
		const notification = new apn.Notification({
			payload: {
				job_app_id: payload.job_application_id,
			},
			alert: {
				title: payload.title,
				subtitle: payload.subtitle,
				body: payload.body,
			},
			badge: payload.badge,
			topic: "tech.jamesshah.OpportuniTrack",
		});

		const { sent, failed } = await apnProvider.send(notification, [
			device_token,
		]);

		if (failed.length > 0) {
			console.error("Failed to send notification:", failed);
		}

		console.log("Successfully sent notification!", sent);
	} catch (e) {
		console.log(`Something went wrong: ${e}`);
	}
}

start();

// ot-spaces
// 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
