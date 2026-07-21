# Finance Controll

A sleek and modern web application to manage and analyze your investment portfolio using Google Sheets as a data source. 

## Features

- **Dashboard**: Get a clear overview of your current holdings, asset allocation, and overall portfolio performance.
- **Dynamic Charts**: Interactive visualizations to track monthly evolution and individual asset historical prices.
- **Trade History**: Detailed table view of all your buy and sell operations.
- **Customizable Themes**: Choose from multiple built-in color themes to personalize your experience.
- **Google Sheets Integration**: Seamlessly connect your public Google Spreadsheet (via CSV export) as your central database. 

## Tech Stack

- **Backend**: Python (Flask)
- **Frontend**: HTML5, CSS3, TypeScript
- **Database**: SQLite (for user preferences and auth state)
- **Authentication**: Google OAuth

## Setup & Installation

### Backend

1. **Install dependencies:**
   Ensure you have Python installed, then run:
   ```bash
   pip install -r requirements.txt
   ```
2. **Environment Variables:**
   Set up your Google OAuth client credentials and other configuration in a `.env` file if necessary.
3. **Run the server:**
   You can start the backend using the provided `start` script or running:
   ```bash
   python backend/server.py
   ```

### Frontend

The frontend is written in TypeScript and needs to be built before serving.

1. **Install dependencies:**
   Navigate to the `frontend/` directory and run:
   ```bash
   cd frontend
   npm install
   ```
2. **Build TypeScript:**
   ```bash
   npm run build
   ```
   *For active development, use `npm run watch`.*

## Connecting Your Spreadsheet

1. Create a Google Spreadsheet with your investment operations.
2. Click **Share** > **Publish to web**.
3. Select "Comma-separated values (.csv)" and click **Publish**.
4. Log into Finance Controll, navigate to the **Profile** section, and paste the link into the **Google Sheets Link** field.
5. Define your column mappings if they differ from the default template.
