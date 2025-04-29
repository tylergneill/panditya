# extract from big CSV to small CSV

import os
import pandas as pd

# Load the input CSV file

current_file_dir = os.path.dirname(os.path.abspath(__file__))
relative_data_dir = "../data"
input_filename = "2024-12-23-pandit-entities-export.csv"
df = pd.read_csv(
    os.path.join(current_file_dir, relative_data_dir, input_filename),
    dtype=str,
)

# Specify the desired columns
columns_to_keep = [
    "Content type",
    "ID",
    "Title",
    "Aka",
    "Social identifiers",
    "Author (person IDs)",
    "Authors (person)",
    "Attributed author (person ID)",
    "Attributed author (person)",
    "Discipline",
    "Commentary on (work ID)",
    "Commentary on (work)",
    "Highest Year",
    "Lowest Year",
]

# Filter the DataFrame to keep only the specified columns
df_filtered = df[columns_to_keep]

# Further filter: Only keep rows where "Content type" is "Work" or "Person"
df_filtered = df_filtered[df_filtered["Content type"].isin(["Work", "Person"])]

# Merge "Attributed author" into "Author"
# If "Author" is empty, fill it with "Attributed author"
# In rare cases where work has both, discard Attributed Author
# TODO: eventually maintain this distinction

df_filtered["Author (person IDs)"] = df_filtered["Author (person IDs)"].fillna("").astype(str)
df_filtered.loc[df_filtered["Author (person IDs)"].str.strip() == "", "Author (person IDs)"] = df_filtered["Attributed author (person ID)"]
df_filtered["Authors (person)"] = df_filtered["Authors (person)"].fillna("").astype(str)
df_filtered.loc[df_filtered["Authors (person)"].str.strip() == "", "Authors (person)"] = df_filtered["Attributed author (person)"]

# Clean up double separators and trailing separators
df_filtered["Author (person IDs)"] = df_filtered["Author (person IDs)"].str.replace(r";\s*;", ";", regex=True).str.strip("; ")
df_filtered["Authors (person)"] = df_filtered["Authors (person)"].str.replace(r";\s*;", ";", regex=True).str.strip("; ")

# Drop the two "Attributed author" columns
df_filtered = df_filtered.drop(columns=["Attributed author (person ID)", "Attributed author (person)"], errors="ignore")

# Rename columns
df_filtered.rename(columns={
    "Title": "Name",
    "Author (person IDs)": "Authors (IDs)",
    "Authors (person)": "Authors (names)",
    "Commentary on (work ID)": "Base texts (IDs)",
    "Commentary on (work)": "Base texts (names)"
}, inplace=True)

# Replace NaN with empty strings to avoid 'nan' in output
df_filtered.fillna("", inplace=True)

# Save the output to a new CSV file
output_filename = "2024-12-23-works-raw.csv"
df_filtered.to_csv(os.path.join(current_file_dir, relative_data_dir, output_filename), index=False)

print(f"Filtered CSV saved as {output_filename}")
