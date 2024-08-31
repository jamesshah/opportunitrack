import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database, Tables, TablesInsert } from "./supabase_types";
import { JobApplicationMessage } from "./types.js";

class SupabaseHelper {
	private config = {
		apiUrl: process.env.SUPABASE_API_URL!,
		apiKey: process.env.SUPABASE_API_KEY!,
	};

	private client: SupabaseClient;

	constructor() {
		try {
			this.client = createClient(this.config.apiUrl, this.config.apiKey);
			console.log("Supabase client connected");
		} catch (error) {
			console.error(error);
			console.error("Exiting...");
			process.exit(1);
		}
	}

	async saveJobApplications(
		data: JobApplicationMessage,
		user_id: string
	): Promise<number | null> {
		const insertData: TablesInsert<"JobApplications">[] =
			data.job_applications.map((job_app) => ({
				user_id: user_id,
				company_name: job_app.company,
				job_position: job_app.position,
				job_status: job_app.category.toString(),
				date: job_app.date.toString(),
			}));

		const { error, count } = await this.client
			.from("JobApplications")
			.insert<TablesInsert<"JobApplications">[]>(insertData)
			.select();

		if (error) {
			console.error("Failed to save job:", error);
			throw error;
		}

		console.debug(`${count} jobs saved successfully`);
		return count;
	}

	async updateBackgroundProcessStatus(background_job_id: number) {
		const { error } = await this.client
			.from("BackgroundProcess")
			.update({ status: "COMPLETED" })
			.eq("id", background_job_id);

		if (error) {
			console.error("Failed to update background process status:", error);
			throw error;
		}

		console.log("Background process updated successfully!");
	}

	async getUserFromGrantId(
		grant_id: string
	): Promise<Tables<"Users"> | undefined> {
		const { data, error } = await this.client
			.from("Users")
			.select()
			.eq("grant_id", grant_id)
			.limit(1)
			.returns<Tables<"Users">>()
			.single();

		if (error) {
			console.error("Error while getting user from grant_id: ", error);
		} else {
			return data;
		}
	}
}

export default SupabaseHelper;
