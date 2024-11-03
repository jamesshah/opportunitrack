import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database, Tables, TablesInsert, TablesUpdate } from "./supabase_types";
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

	async saveJobApplication(
		job_app: JobApplicationMessage,
		user_id: string
	): Promise<any | null> {
		// find if job_application with company_name and job_position exists for this user.

		const { data, error: fetch_error } = await this.client
			.from("JobApplications")
			.select()
			.eq("user_id", user_id)
			.eq("company_name", job_app.job_application.company)
			.eq("job_position", job_app.job_application.position)
			.order("id", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (fetch_error) {
			console.error(
				"Error while checking existing job application",
				fetch_error
			);
		}

		if (data != null) {
			const updateData: TablesUpdate<"JobApplications"> = {
				id: data.id,
				job_status: job_app.job_application.category.toString(),
				date: job_app.job_application.date.toString(),
			};
			const { error: update_error, data: update_data } = await this.client
				.from("JobApplications")
				.update<TablesUpdate<"JobApplications">>(updateData)
				.select()
				.limit(1)
				.single();

			if (update_error) {
				console.error(
					"Failed to update job application:",
					update_error
				);
				throw update_error;
			}

			console.debug(`job application updated successfully`);
			return update_data;
		}

		const insertData: TablesInsert<"JobApplications"> = {
			user_id: user_id,
			company_name: job_app.job_application.company,
			job_position: job_app.job_application.position,
			job_status: job_app.job_application.category.toString(),
			date: job_app.job_application.date.toString(),
		};

		const { error: save_error, data: insert_data } = await this.client
			.from("JobApplications")
			.insert<TablesInsert<"JobApplications">>(insertData)
			.select()
			.limit(1)
			.single();

		if (save_error) {
			console.error("Failed to save job application:", save_error);
			throw save_error;
		}

		console.debug(`job application saved successfully`);
		return insert_data;
	}

	async savePredictionLog(job_app: JobApplicationMessage) {
		const prediction_data = {
			subject: job_app.email_data.subject,
			body: job_app.email_data.body,
			company: job_app.job_application.company,
			position: job_app.job_application.position,
			status: job_app.job_application.category,
		};

		const { data, error } = await this.client
			.from("prediction_logs")
			.insert(prediction_data)
			.select()
			.maybeSingle();

		if (error) {
			console.error("error while storing prediction logs:", error);
		}
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
