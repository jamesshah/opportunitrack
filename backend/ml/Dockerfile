# Use Miniconda as the base image
FROM continuumio/miniconda3

# Set working directory inside the container
WORKDIR /ml

# Copy the environment.yml file into the container
COPY . .

# Install the conda environment specified in environment.yml
RUN conda env create -f environment.yml --name myenv

# Make RUN commands use the new environment:
# Make RUN commands use the new environment:
RUN echo "conda activate myenv" >> ~/.bashrc
CMD ["/bin/bash", "--login", "-c"]
    
# The code to run when container is started:
ENTRYPOINT ["conda", "run", "--no-capture-output", "-n", "myenv", "python3", "worker.py"]