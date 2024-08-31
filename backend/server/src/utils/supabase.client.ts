import { createClient, SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

class Supabase {
	private static instance: SupabaseClient;

	private static config = {
		apiUrl: process.env.SUPABASE_API_URL,
		apiKey: process.env.SUPABASE_API_KEY,
	};

	private constructor() {}

	static getInstance(): SupabaseClient | undefined {
		try {
			if (!this.instance) {
				if (this.config.apiKey && this.config.apiUrl) {
					this.instance = createClient(
						this.config.apiUrl,
						this.config.apiKey
					);
				} else {
					throw Error(
						"Invalid/Missing configurations. Please set api key and url for supabase in env variables"
					);
				}
			}
			return this.instance;
		} catch (error) {
			console.error("[ERROR] Cannot get instance of supabase", error);
		}
	}
}

export default Supabase;
