enum JobCategory {
	APPLIED,
	INVITED_FOR_INTERVIEW,
	REJECTED,
	OFFERED,
}

export type JobApplicationMessage = {
	company: string;
	position: string;
	category: JobCategory;
	date: string;
};
