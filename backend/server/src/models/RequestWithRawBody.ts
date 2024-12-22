import { Request } from "express";

// Extend the Express Request type
export interface RequestWithRawBody extends Request {
	rawBody?: Buffer;
}
