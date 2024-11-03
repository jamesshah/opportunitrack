import { createClient } from "redis";

const client = createClient({
	socket: {
		host: process.env.REDIS_HOST || "localhost",
		port: 6379,
	},
});

// client.on("error", (err) => {
// 	console.error("Redis error:", err);
// });

// client.on("connect", () => {
// 	console.error("Redis connected:");
// });

client.connect();

export default client;

// export default class RedisClient {
// 	private static instance: RedisClientType;

// 	private constructor() {}

// 	public static QUEUE = {
// 		PROCESS_EMAIL_QUEUE: "process-email-queue",
// 	};

// 	static async getInstance(): Promise<RedisClientType> {
// 		if (RedisClient.instance == undefined) {
// 			RedisClient.instance = createClient();
// 			await RedisClient.instance.connect();
// 			console.log("Connected to redis");
// 		}
// 		return RedisClient.instance;
// 	}

// 	static async sendMessage(data: any) {
// 		try {
// 			const redisClient = await RedisClient.getInstance();
// 			// console.log(redisClient);
// 			const response = await redisClient.lPush(
// 				RedisClient.QUEUE.PROCESS_EMAIL_QUEUE,
// 				JSON.stringify(data)
// 			);
// 			console.log(response);
// 		} catch (err) {
// 			console.error(err);
// 			throw err;
// 		}
// 	}
// }
