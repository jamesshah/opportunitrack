import Nylas, { CodeExchangeRequest, URLForAuthenticationConfig } from "nylas";
import "dotenv/config";
import { NylasConfig } from "nylas/lib/types/config";

export default class NylasClient {
	private static instance: Nylas;

	private static config = {
		apiKey: process.env.NYLAS_API_KEY!,
		apiUri: process.env.NYLAS_API_URI,
		clientId: process.env.NYLAS_CLIENT_ID!,
		redirectUri: process.env.NYLAS_AUTH_CALLBACK_URI!,
	};

	private constructor() {}

	static getInstance() {
		if (!NylasClient.instance) {
			NylasClient.instance = new Nylas({
				apiKey: NylasClient.config.apiKey,
				apiUri: NylasClient.config.apiUri,
			});
		}

		return NylasClient.instance;
	}

	static getUrlAuthConfigs(): URLForAuthenticationConfig {
		return {
			clientId: NylasClient.config.clientId,
			redirectUri: NylasClient.config.redirectUri,
		};
	}

	static getCodeExchangePayload(code: string): CodeExchangeRequest {
		return {
			clientId: NylasClient.config.clientId,
			redirectUri: NylasClient.config.redirectUri,
			clientSecret: NylasClient.config.apiKey,
			code,
		};
	}
}
