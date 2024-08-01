module.exports = function (router) {

	router.get('*',function (req, res) {
        //logger.info("404 Hit");
        res.status(400);
    });
    
    
}