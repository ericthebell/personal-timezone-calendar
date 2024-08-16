import React, { useState } from 'react';

function EventForm() {
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // TODO: Implement event creation logic
    console.log('New event:', { eventName, eventDate, eventTime });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={eventName}
        onChange={(e) => setEventName(e.target.value)}
        placeholder="Event Name"
        required
      />
      <input
        type="date"
        value={eventDate}
        onChange={(e) => setEventDate(e.target.value)}
        required
      />
      <input
        type="time"
        value={eventTime}
        onChange={(e) => setEventTime(e.target.value)}
        required
      />
      <button type="submit">Create Event</button>
    </form>
  );
}

export default EventForm;