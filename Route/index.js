import workflow from './workflow.js';
import express from 'express';
const routes = express.Router();
import auth from './auth.js'
import user from './user.js'
import home from './home.js'
import dashboard from './dashboard.js'
import warehouse from './wareHouse.js'

routes.use('/home',home)

routes.use('/auth',auth)
routes.use('/user',user)
routes.use('/dashboard',dashboard)
routes.use('/warehouse', warehouse)
routes.use('/workflow', workflow)

export default routes;
