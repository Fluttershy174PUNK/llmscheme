import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.querySelector('#app');
if (target) mount(App, { target });
