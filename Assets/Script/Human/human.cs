using System.Collections;
using System.Collections.Generic;

public class Human 
{
    static int id = 0;
    Status status;

    public Human() {
        id++;
        status = new Status();
    }

}
