export enum JobApplicationCategory {
	APPLIED,
	INVITED_FOR_INTERVIEW,
	REJECTED,
	OFFERED,
}

export type JobApplication = {
	company: string;
	position: string;
	category: JobApplicationCategory;
	date: Date;
};

export type EmailData = {
	sender: string;
	subject: string;
	body: string;
	date: Date;
};

export type JobApplicationMessage = {
	grant_id: string;
	background_job_id?: number;
	job_application: JobApplication;
	email_data: EmailData;
};

export type NotificationPayload = {
	title: string;
	subtitle: string;
	body: string;
	job_application_id: number;
	badge?: number;
};
