import redis
import json
from datetime import datetime, date
from bs4 import BeautifulSoup
from enum import Enum
import requests
from typing import List
import os
import time

class Task(Enum):
    CLASSIFICATION = 1
    NER = 2

class TaskObj:
    def __init__(self, data, grantId: str) -> None:
        self.data = data
        self.grant_id = grantId
        
    @classmethod
    def from_dict(cls, task: dict) -> 'TaskObj':
        return cls(
            data=task["data"],
            grantId=task["grantId"]
        )

class EmailData:
    def __init__(self, subject: str, body: str, sender, date: date) -> None:
        self.subject = subject
        self.body = body
        self.date = date
        self.sender = sender        

    def __repr__(self) -> str:
        return f"\n[Subject: {self.subject},\n Body: {self.body},\n From: {self.sender},\n Date: {self.date}]"
    
    def to_dict(self) -> dict: 
        return {
            "subject": self.subject,
            "body": self.body,
            "date": self.date.isoformat(),
            "sender": self.sender[0]
        }

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

            max_retries = 30  # Maximum number of retries
            retry_interval = 1  # Time between retries in seconds

            for attempt in range(max_retries):
                self.redis_client = redis.Redis(
                    host=os.getenv("REDIS_HOST", "redis"), port=os.getenv("REDIS_PORT", "6379"), decode_responses=True
                )
                self.redis_client.ping()
                print("Connected to redis!")
                break

            print("[INFO] : Worker setup completed...")
        except redis.ConnectionError as e:
            print(f"Attempt {attempt + 1}/{max_retries}: Failed to connect to Redis. Retrying in {retry_interval} seconds...")
            time.sleep(retry_interval)
            
        except Exception as err:
            print(f"[ERROR] Cannot initialize worker : {err}")
            # exit(1)
            
    def query(self, query:str, labels:List[str], task:Task):
        if task == Task.CLASSIFICATION:
            API_URL = os.getenv("CLASSIFIER_API_URL")
            API_KEY= os.getenv("CLASSIFIER_API_KEY")
            headers = {"Authorization": f"Bearer {API_KEY}"}
            payload = {
                "inputs": query,
                "parameters": {"candidate_labels": labels}
            }
        elif task == Task.NER:
            API_URL = os.getenv("NER_API_URL")
            API_KEY= os.getenv("NER_API_KEY")
            headers = {"Authorization": f"Bearer {API_KEY}"}
            payload = {
                "text": query,
                "labels": labels
            }
            
        if (API_URL == None):
            print("Api Url not provided")
            return Exception("Api Url not provided")
        
        response = requests.post(API_URL, headers=headers, json=payload)
        return response.json()

    # Step 1: Clean the data and return EmailData class
    def clean_data(self, email) -> EmailData | None:        
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
            raise err

    # Step 2: Classify if this email is related to job application status
    def is_email_job_related(self, email: EmailData) -> bool | None:
        try:
            result = self.query(email.body, Worker.EMAIL_TYPE_LABELS, Task.CLASSIFICATION)           
            print(result)
            index = result["labels"].index("job-application")
            
            return result["scores"][index] > 0.5 # type: ignore

        except Exception as err:
            print(f"[ERROR]: Cannot filter email : {err}")
            raise err

    # Step 3: Get Company Name and Job Position
    def get_application_data(self, email: EmailData) -> JobApplication | None:
        try:
            entities = self.query(email.body, Worker.NER_LABELS, Task.NER)["entities"]
            
            print(entities)

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
            raise err

    # Step 3.1: Get the job status from the email
    def find_job_status_from_email(self, email: EmailData) -> JobApplication.Category | None:
        try:
            result = self.query(email.body, Worker.APPLICATION_STATUS_LABELS, Task.CLASSIFICATION)
            
            print(result)
            
            indexOfMaxScore = result["scores"].index(max(result["scores"]))
            
            return JobApplication.Category.getFromLabel(result["labels"][indexOfMaxScore])
        except Exception as err:
            print(f"[ERROR] Cannot find job status from email: {err}")
            raise err

    def process_task(self, task):
        try:
            taskObj = TaskObj.from_dict(json.loads(task))
            
            email = self.clean_data(taskObj.data)
                        
            if email == None:
                print("[Warning] Could not clean email. Skipping the email...")
                pass
            else:
                print("COMPLETED cleaning data...")
                if (self.is_email_job_related(email)):
                    job_application = self.get_application_data(email)
                    if (job_application):
                        output = job_application.to_dict()
                        print("Processing completed. Pushing data into completion queue...")
                        
                        print(output)
                
                        final_output = {
                            'job_application': output,
                            "email_data": email.to_dict(),
                            "grant_id": taskObj.grant_id
                        }                
                        
                        print(final_output)
                        
                        self.redis_client.lpush(
                            'completion-queue', json.dumps(final_output, indent=2)
                        )
                        print("Data pushed successfully!")
                else:
                    print("Email was not job related")
        
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
    print("starting worker.py")
    worker = Worker()
    worker.start()