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

export type JobApplicationMessage = {
	grant_id: string;
	background_job_id?: number;
	job_applications: JobApplication[];
};

export type NotificationPayload = {
	title: string;
	subtitle: string;
	body: string;
	badge?: number;
};
