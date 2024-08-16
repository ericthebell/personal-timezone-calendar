import React from 'react';
import logo from './logo.svg';
import './App.css';
import EventForm from './components/EventForm';
import WeekCalendar from './components/WeekCalendar';
import { Container, CssBaseline, ThemeProvider, createTheme } from '@mui/material';

const theme = createTheme();

function App() {
  return (
    <React.Fragment>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Container maxWidth="lg">
          <div className="App">
            <h1>Personal Timezone Calendar</h1>
            <EventForm />
            <WeekCalendar />
          </div>
        </Container>
      </ThemeProvider>
    </React.Fragment>
  );
}

export default App;