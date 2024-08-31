import redis
import json
from datetime import datetime, date
from bs4 import BeautifulSoup
from transformers import pipeline
from gliner import GLiNER
from enum import Enum
import torch
from typing import Optional

class TaskObj:
    def __init__(self, data, grantId: str, backgroundJobId: Optional[int] = None) -> None:
        self.data = data
        self.grant_id = grantId
        self.background_job_id = backgroundJobId
        
    @classmethod
    def from_dict(cls, task: dict) -> 'TaskObj':
        return cls(
            data=task["data"],
            grantId=task["grantId"],
            backgroundJobId=task["backgroundJobId"] if task["backgroundJobId"] else None
        )

class EmailData:
    def __init__(self, subject: str, body: str, sender, date: date) -> None:
        self.subject = subject
        self.body = body
        self.date = date
        self.sender = sender        

    def __repr__(self) -> str:
        return f"\n[Subject: {self.subject},\n Body: {self.body},\n From: {self.sender},\n Date: {self.date}]"

class JobApplication:

    class Category(Enum):
        APPLIED = 1
        INVITED_FOR_INTERVIEW = 2
        REJECTED = 3
        OFFERED = 4
        
        @staticmethod 
        def getFromLabel(label: str):
            if (label == "job applied"):
                return JobApplication.Category.APPLIED
            if (label == "job interview"):
                return JobApplication.Category.INVITED_FOR_INTERVIEW
            if (label == "job application rejected"):
                return JobApplication.Category.REJECTED
            if (label == "job offered"):
                return JobApplication.Category.OFFERED
            

    def __init__(self, company: str, position: str, category: Category | None, date: date) -> None:
        self.company = company
        self.position = position
        self.category = category
        self.date = date
        
    def to_dict(self) -> dict:
        return {
            "company": self.company,
            "position": self.position,
            "category": self.category.name if self.category else None,
            "date": self.date.isoformat()
        }
        
    @classmethod
    def from_dict(cls, data: dict) -> 'JobApplication':
        category = cls.Category[data["category"]] if data["category"] else None
        return cls(
            company=data["company"],
            position=data["position"],
            category=category,
            date=date.fromisoformat(data["date"])
        )

    def __repr__(self) -> str:
        return f"\n[Company: {self.company},\n Position: {self.position},\n Category: {self.category},\n Date: {self.date}]"


class Worker:
    EMAIL_TYPE_LABELS = ["job-application", "other"]
    APPLICATION_STATUS_LABELS = [
        "job applied", "job interview", "job application rejected", "job offered"]
    NER_LABELS = ["company", "job position"]

    def __init__(self):
        try:
            print("[INFO] : Worker setup started...")

            if torch.backends.mps.is_available():
                print("[INFO] : GPU is available. Running inferences on GPU")
                mps = torch.device("mps")
                self.classifier = pipeline(
                    model="facebook/bart-large-mnli", device=mps)
                self.ner_model = GLiNER.from_pretrained(
                    "urchade/gliner_large-v2.1")
                self.ner_model.to(mps)
            else:
                print("[INFO] : GPU is NOT available. Running inferences on CPU")
                self.classifier = pipeline(model="facebook/bart-large-mnli")
                self.ner_model = GLiNER.from_pretrained(
                    "urchade/gliner_large-v2.1")

            self.redis_client = redis.Redis(
                host='localhost', port=6379, decode_responses=True)

            print("[INFO] : Worker setup completed...")
        except Exception as err:
            print(f"[ERROR] Cannot initialize worker : {err}")
            exit(1)

    # Step 1: Clean the data and return EmailData class
    def clean_data(self, email) -> EmailData | None:
        print("cleaning data started")
        try:            
            return EmailData(
                email["subject"],
                BeautifulSoup(
                    email["body"], features="html.parser").get_text("", True).strip("\n"),
                email["from"],
                datetime.fromtimestamp(email["date"]).date()
                )            

        except Exception as err:
            print(f"[ERROR] Cannot clean data: {err}")

    # Step 2: Classify if this email is related to job application status
    def is_email_job_related(self, email: EmailData) -> bool | None:
        print("filtering data started")

        try:
            result = self.classifier(email.body, candidate_labels=[
                                     "job-application", "other"])
            
            return result["scores"][result["labels"].index("job-application")] > 0.5 # type: ignore

        except Exception as err:
            print(f"[ERROR]: Cannot filter email : {err}")

    # Step 3: Get Company Name and Job Position
    def get_application_data(self, email: EmailData) -> JobApplication | None:
        print("get_application_data started")

        try:
            entities = self.ner_model.predict_entities(
                email.body, Worker.NER_LABELS)

            # print(entities)

            category = self.find_job_status_from_email(email)

            company = ""
            job_position = ""

            # Find company entity from entities with highest score
            company = max(
                list(
                    filter(lambda ent: ent["label"] == "company", entities)
                ), key=lambda ent: ent["score"]
            )["text"]

            job_position = max(
                list(
                    filter(lambda ent: ent["label"] ==
                           "job position", entities)
                ), key=lambda ent: ent["score"]
            )["text"]

            return JobApplication(company, job_position, category, email.date)

        except Exception as err:
            print(f"[ERROR] Cannot get application data : {err}")

    # Step 3.1: Get the job status from the email
    def find_job_status_from_email(self, email: EmailData) -> JobApplication.Category | None:
        print("getting job status started")
        try:
            result = self.classifier(
                email.body, candidate_labels=Worker.APPLICATION_STATUS_LABELS)
            # print(result)
            return JobApplication.Category.getFromLabel(result["labels"][result["scores"].index(max(result["scores"]))]) # type: ignore
        except Exception as err:
            print(f"[ERROR] Cannot find job status from email: {err}")

    def process_task(self, task):
        print(f"Processing started")
        # print(task)
        try:
            taskObj = TaskObj.from_dict(json.loads(task))
        
            print(taskObj)
            
            output = []
            print("STARTED cleaning data...")
            cleaned_emails = map(lambda email: self.clean_data(email), taskObj.data)
            
            print("COMPLETED cleaning data...")
            
            for email in cleaned_emails:
                if email == None:
                    print("[Warning] Could not clean email. Skipping the email...")
                    pass
                else:
                    print("STARTED filtering email")
                    if (self.is_email_job_related(email)):
                        job_application = self.get_application_data(email)
                        if (job_application):
                            output.append(job_application.to_dict())
                    else:
                        print("Email was not job related")
            
            print("Processing completed. Pushing data into completion queue...")
            
            final_output = {
                "job_applications": output,
                "grant_id": taskObj.grant_id
            }
            
            if taskObj.background_job_id  is not None:
                final_output["background_job_id"] = taskObj.background_job_id
            
            self.redis_client.lpush(
                'completion-queue', json.dumps(final_output, indent=2)
            )
            
            print("Data pushed successfully!")
        
        except KeyError as err:
            print("Invalid input message. Cannot process task", err)
        
        except Exception as err:
            print("Something went wrong. Cannot process task", err)

    def start(self):
        while True:
            _, message = self.redis_client.brpop("process-email-queue", 0)
            if message:
                print("Received a message on queue")
                self.process_task(message)


if __name__ == "__main__":
    worker = Worker()
    worker.start()