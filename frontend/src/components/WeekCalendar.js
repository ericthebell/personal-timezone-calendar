import React from 'react';
import { 
  Paper, 
  Grid, 
  Typography, 
  Box,
  styled
} from '@mui/material';
import { startOfWeek, addDays, format } from 'date-fns';

const CalendarPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '80vh',
  overflow: 'auto'
}));

const DayColumn = styled(Grid)(({ theme }) => ({
  borderRight: `1px solid ${theme.palette.divider}`,
  '&:last-child': {
    borderRight: 'none'
  }
}));

const HourRow = styled(Box)(({ theme }) => ({
  borderBottom: `1px solid ${theme.palette.divider}`,
  height: '60px',
  position: 'relative'
}));

const WeekCalendar = () => {
  const startDate = startOfWeek(new Date());
  const weekDays = [...Array(7)].map((_, i) => addDays(startDate, i));
  const hours = [...Array(24)].map((_, i) => i);

  return (
    <CalendarPaper elevation={3}>
      <Grid container>
        {weekDays.map((day, index) => (
          <DayColumn item xs key={index}>
            <Typography variant="subtitle1" align="center" gutterBottom>
              {format(day, 'EEE dd/MM')}
            </Typography>
            {hours.map((hour) => (
              <HourRow key={hour}>
                {hour === 0 && (
                  <Typography variant="caption" sx={{ position: 'absolute', top: -10, left: 0 }}>
                    {`${hour}:00`}
                  </Typography>
                )}
              </HourRow>
            ))}
          </DayColumn>
        ))}
      </Grid>
    </CalendarPaper>
  );
};

export default WeekCalendar;
