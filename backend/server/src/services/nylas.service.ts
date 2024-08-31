import { ListMessagesQueryParams, Message } from "nylas";
import { NylasClient, Utils } from "../utils/index.js";

const nylas = NylasClient.getInstance();

async function getEmails(grant_id: string): Promise<Message[]> {
	try {
		let allRecords: Message[] = [];
		let nextCursor: string | undefined = undefined;
		let hasNext = true;

		while (hasNext) {
			const params: ListMessagesQueryParams = {
				limit: 20,
				receivedAfter: Utils.getTimestampDaysAgo(),
			};

			if (nextCursor) {
				params.pageToken = nextCursor;
			}

			let response = await nylas.messages.list({
				identifier: grant_id,
				queryParams: params,
			});

			allRecords = allRecords.concat(response.data);

			hasNext = response.nextCursor != undefined;
			nextCursor = response.nextCursor;
		}

		console.log(
			`Fetched ${allRecords.length} emails for grant_id : ${grant_id}`
		);

		return allRecords;
	} catch (error) {
		console.error("Error fetching emails:", error);
		throw error;
	}
}

export { getEmails };
